// Cross-source deduplication (GitHub issue #2).
//
// The same artist or institution arrives from several source APIs (Auguste
// Rodin appears once per museum). This pass folds those duplicates together so
// a person or institution is one canonical record.
//
// How it works:
//   - Duplicate rows are never deleted; deleting them would break the idempotent
//     (source, source_id) upserts ingestion relies on. Instead each duplicate
//     keeps its row and points at the survivor via the merged_into column.
//   - Foreign keys that the app actually queries (artworks.artist_id,
//     artworks.current_institution_id, exhibitions.institution_id) are
//     repointed onto the survivor, so artwork counts aggregate correctly.
//   - The survivor is enriched with any non-null fields the losers carry that
//     it lacks (birth/death year, nationality, bio, wikidata_id), satisfying
//     the Wikidata-enrichment half of issue #2.
//
// Idempotent: rows already merged are skipped, and an established survivor is
// kept as survivor on re-runs so detail-page URLs stay stable. Run it after
// every ingestion.
//
//   pnpm dedup -- --dry-run    Report what would change, write nothing.
//   pnpm dedup                 Apply.
//   pnpm dedup -- --verbose    List every merge group.

import { createAdminClient } from "./lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

// Lower index wins when picking a survivor: museum APIs carry richer, more
// reliable records than the Wikidata enrichment layer.
const SOURCE_PRIORITY = ["aic", "met", "cleveland", "qagoma", "wikidata"];

// Normalized-name fragments that mark a row as a catalogue placeholder rather
// than a named person. Rows matching these are never merged: "Anonymous,
// German, 16th century" and "Anonymous, German, 17th century" are distinct
// catalogue entities, and "Attributed to Rembrandt" is not "Rembrandt".
const NON_MERGEABLE =
  /\b(anonymous|unknown|unidentified|attributed|after|follower|imitator|workshop|circle|manner|studio|school|various|multiple|unnamed)\b/;

// Known cross-source institution equivalences whose names do not match by
// text. Each inner array is one institution under different source labels,
// listed as normalized names.
const INSTITUTION_ALIASES: string[][] = [
  ["queensland art gallery", "queensland art gallery and gallery of modern art"],
];

interface Args {
  dryRun: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  let verbose = false;
  for (const arg of argv) {
    if (arg === "--") continue;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--verbose") verbose = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { dryRun, verbose };
}

// Lowercase, strip diacritics and punctuation, collapse whitespace. This is the
// match key: "Albrecht Dürer" and "Albrecht Durer" normalize identically.
function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceRank(source: string): number {
  const i = SOURCE_PRIORITY.indexOf(source);
  return i === -1 ? SOURCE_PRIORITY.length : i;
}

interface ArtistRow {
  id: string;
  name: string;
  sort_name: string | null;
  also_known_as: string[];
  birth_year: number | null;
  death_year: number | null;
  nationality: string | null;
  bio: string | null;
  wikidata_id: string | null;
  gnd_id: string | null;
  image_url: string | null;
  movements: string[];
  source: string;
  created_at: string;
  merged_into: string | null;
}

interface InstitutionRow {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  website: string | null;
  wikidata_id: string | null;
  source: string;
  created_at: string;
  merged_into: string | null;
}

// Fetch every row of a table, paging past Supabase's 1000-row response cap.
async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

// Order rows within a merge group so the strongest record sorts first: most
// complete, then most trusted source, then oldest (stable), then by id.
function byStrength<T extends { source: string; created_at: string; id: string }>(
  completeness: (row: T) => number,
): (a: T, b: T) => number {
  return (a, b) => {
    const ca = completeness(a);
    const cb = completeness(b);
    if (ca !== cb) return cb - ca;
    const ra = sourceRank(a.source);
    const rb = sourceRank(b.source);
    if (ra !== rb) return ra - rb;
    if (a.created_at !== b.created_at)
      return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  };
}

// Pick the survivor for a group. If one member is already the target of a
// previous merge, keep it so detail-page URLs stay stable across re-runs;
// otherwise take the strongest row.
function pickSurvivor<T extends { id: string }>(
  group: T[],
  sorted: T[],
  mergeTargets: Set<string>,
): T {
  const established = group.filter((row) => mergeTargets.has(row.id));
  if (established.length === 1) return established[0];
  return sorted[0];
}

interface GroupReport {
  key: string;
  survivor: string;
  losers: number;
}

async function dedupeArtists(
  supabase: SupabaseClient,
  args: Args,
): Promise<{ groups: GroupReport[]; rowsMerged: number; artworksRepointed: number }> {
  const artists = await fetchAll<ArtistRow>(
    supabase,
    "artists",
    "id,name,sort_name,also_known_as,birth_year,death_year,nationality,bio,wikidata_id,gnd_id,image_url,movements,source,created_at,merged_into",
  );

  const mergeTargets = new Set<string>();
  for (const a of artists) if (a.merged_into) mergeTargets.add(a.merged_into);

  // Group canonical rows by either normalized name OR shared wikidata_id, via
  // union-find. The Q-ID edge is the structural fix for cases the trigram
  // similarity misses (issue #20): two rows with different names but the same
  // Wikidata Q-ID are the same person, full stop.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = parent.get(x) ?? x;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const eligible: ArtistRow[] = [];
  const nameSeed = new Map<string, string>();
  const qidSeed = new Map<string, string>();
  // (birth_year|death_year|last_name) tuple seed. Catches "Pablo Picasso" vs
  // "Pablo Ruiz Picasso" (issue #20) and other cases where one source carries
  // the catalogued full name and another the shortened working name. Trigram
  // similarity misses these because the inserted middle name shifts too many
  // trigrams; identical life dates plus a shared family-name token is a much
  // stronger signal. Both years must be present to enter this index, which
  // keeps the false-positive rate near zero.
  const lifeSeed = new Map<string, string>();
  for (const artist of artists) {
    if (artist.merged_into) continue;
    const key = normalize(artist.name);
    if (key.length < 3 || NON_MERGEABLE.test(key)) continue;
    eligible.push(artist);
    parent.set(artist.id, artist.id);
    const sameName = nameSeed.get(key);
    if (sameName) union(artist.id, sameName);
    else nameSeed.set(key, artist.id);
    if (artist.wikidata_id) {
      const sameQid = qidSeed.get(artist.wikidata_id);
      if (sameQid) union(artist.id, sameQid);
      else qidSeed.set(artist.wikidata_id, artist.id);
    }
    if (artist.birth_year != null && artist.death_year != null) {
      const tokens = key.split(" ");
      const lastName = tokens[tokens.length - 1];
      if (lastName && lastName.length >= 3) {
        const lifeKey = `${artist.birth_year}|${artist.death_year}|${lastName}`;
        const sameLife = lifeSeed.get(lifeKey);
        if (sameLife) union(artist.id, sameLife);
        else lifeSeed.set(lifeKey, artist.id);
      }
    }
  }

  const groups = new Map<string, ArtistRow[]>();
  for (const artist of eligible) {
    const root = find(artist.id);
    const bucket = groups.get(root);
    if (bucket) bucket.push(artist);
    else groups.set(root, [artist]);
  }

  const completeness = (a: ArtistRow): number =>
    [
      a.birth_year,
      a.death_year,
      a.nationality,
      a.bio,
      a.wikidata_id,
      a.sort_name,
    ].filter((v) => v != null).length + (a.also_known_as.length > 0 ? 1 : 0);
  const sortStrength = byStrength<ArtistRow>(completeness);

  const reports: GroupReport[] = [];
  let rowsMerged = 0;
  let artworksRepointed = 0;

  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(sortStrength);
    const survivor = pickSurvivor(group, sorted, mergeTargets);
    const losers = group.filter((row) => row.id !== survivor.id);

    // Enrich the survivor: fill its null fields from the losers, preferring the
    // strongest loser. Collect alternate names into also_known_as.
    const enrichOrder = losers
      .slice()
      .sort(sortStrength);
    const update: Partial<ArtistRow> = {};
    const scalarFields = [
      "birth_year",
      "death_year",
      "nationality",
      "bio",
      "wikidata_id",
      "gnd_id",
      "image_url",
      "sort_name",
    ] as const;
    for (const field of scalarFields) {
      if (survivor[field] != null) continue;
      for (const loser of enrichOrder) {
        if (loser[field] != null) {
          (update as Record<string, unknown>)[field] = loser[field];
          break;
        }
      }
    }
    // Aliases: keep every loser name that differs from the survivor's raw
    // name (case, diacritics, hyphens), so a single canonical can advertise
    // "also: Jean-Auguste-Dominique Ingres" alongside its preferred form.
    // Comparing raw names matters here: losers reached this block because
    // their NORMALIZED names match the survivor, so a normalize() comparison
    // would never add an alias.
    const aka = new Set<string>(survivor.also_known_as);
    for (const loser of losers) {
      for (const alt of loser.also_known_as) aka.add(alt);
      if (loser.name !== survivor.name) aka.add(loser.name);
    }
    if (aka.size > survivor.also_known_as.length) {
      update.also_known_as = [...aka];
    }

    reports.push({ key, survivor: survivor.name, losers: losers.length });
    rowsMerged += losers.length;
    const loserIds = losers.map((l) => l.id);

    if (args.verbose) {
      console.log(
        `  "${key}": survivor ${survivor.source}/${survivor.id.slice(0, 8)}, ` +
          `${losers.length} merged [${losers.map((l) => l.source).join(", ")}]` +
          (Object.keys(update).length > 0
            ? ` (+${Object.keys(update).join(", ")})`
            : ""),
      );
    }

    if (args.dryRun) {
      // Count artworks that would be repointed, without writing.
      const { count, error } = await supabase
        .from("artworks")
        .select("id", { count: "exact", head: true })
        .in("artist_id", loserIds);
      if (error) throw error;
      artworksRepointed += count ?? 0;
      continue;
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from("artists")
        .update(update)
        .eq("id", survivor.id);
      if (error) throw error;
    }
    const repoint = await supabase
      .from("artworks")
      .update({ artist_id: survivor.id })
      .in("artist_id", loserIds)
      .select("id");
    if (repoint.error) throw repoint.error;
    artworksRepointed += repoint.data?.length ?? 0;

    const mark = await supabase
      .from("artists")
      .update({ merged_into: survivor.id })
      .in("id", loserIds);
    if (mark.error) throw mark.error;
  }

  return { groups: reports, rowsMerged, artworksRepointed };
}

// Dice coefficient over character bigrams: a cheap 0..1 string similarity used
// only to flag institution pairs a human should look at.
function similarity(a: string, b: string): number {
  const bigrams = (s: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.length === 0 || gb.length === 0) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (const g of ga) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of gb) {
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      hits++;
      counts.set(g, n - 1);
    }
  }
  return (2 * hits) / (ga.length + gb.length);
}

async function dedupeInstitutions(
  supabase: SupabaseClient,
  args: Args,
): Promise<{
  groups: GroupReport[];
  rowsMerged: number;
  artworksRepointed: number;
  exhibitionsRepointed: number;
}> {
  const institutions = await fetchAll<InstitutionRow>(
    supabase,
    "institutions",
    "id,name,city,country,website,wikidata_id,source,created_at,merged_into",
  );

  const mergeTargets = new Set<string>();
  for (const i of institutions) if (i.merged_into) mergeTargets.add(i.merged_into);

  // Map each normalized alias to a shared cluster key.
  const aliasKey = new Map<string, string>();
  for (const cluster of INSTITUTION_ALIASES) {
    const canonical = cluster[0];
    for (const alias of cluster) aliasKey.set(alias, canonical);
  }

  // Group canonical rows: by alias cluster where one applies, else by
  // normalized name.
  const groups = new Map<string, InstitutionRow[]>();
  for (const inst of institutions) {
    if (inst.merged_into) continue;
    const norm = normalize(inst.name);
    const key = aliasKey.get(norm) ?? norm;
    const bucket = groups.get(key);
    if (bucket) bucket.push(inst);
    else groups.set(key, [inst]);
  }

  const completeness = (i: InstitutionRow): number =>
    [i.city, i.country, i.website, i.wikidata_id].filter((v) => v != null).length;
  const sortStrength = byStrength<InstitutionRow>(completeness);

  const reports: GroupReport[] = [];
  let rowsMerged = 0;
  let artworksRepointed = 0;
  let exhibitionsRepointed = 0;

  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(sortStrength);
    const survivor = pickSurvivor(group, sorted, mergeTargets);
    const losers = group.filter((row) => row.id !== survivor.id);
    const loserIds = losers.map((l) => l.id);

    const enrichOrder = losers.slice().sort(sortStrength);
    const update: Partial<InstitutionRow> = {};
    for (const field of ["city", "country", "website", "wikidata_id"] as const) {
      if (survivor[field] != null) continue;
      for (const loser of enrichOrder) {
        if (loser[field] != null) {
          (update as Record<string, unknown>)[field] = loser[field];
          break;
        }
      }
    }

    reports.push({ key, survivor: survivor.name, losers: losers.length });
    rowsMerged += losers.length;

    if (args.verbose) {
      console.log(
        `  "${key}": survivor ${survivor.source}/"${survivor.name}", ` +
          `${losers.length} merged [${losers
            .map((l) => `${l.source}/"${l.name}"`)
            .join(", ")}]`,
      );
    }

    if (args.dryRun) {
      const aw = await supabase
        .from("artworks")
        .select("id", { count: "exact", head: true })
        .in("current_institution_id", loserIds);
      if (aw.error) throw aw.error;
      artworksRepointed += aw.count ?? 0;
      const ex = await supabase
        .from("exhibitions")
        .select("id", { count: "exact", head: true })
        .in("institution_id", loserIds);
      if (ex.error) throw ex.error;
      exhibitionsRepointed += ex.count ?? 0;
      continue;
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from("institutions")
        .update(update)
        .eq("id", survivor.id);
      if (error) throw error;
    }
    const awRepoint = await supabase
      .from("artworks")
      .update({ current_institution_id: survivor.id })
      .in("current_institution_id", loserIds)
      .select("id");
    if (awRepoint.error) throw awRepoint.error;
    artworksRepointed += awRepoint.data?.length ?? 0;

    const exRepoint = await supabase
      .from("exhibitions")
      .update({ institution_id: survivor.id })
      .in("institution_id", loserIds)
      .select("id");
    if (exRepoint.error) throw exRepoint.error;
    exhibitionsRepointed += exRepoint.data?.length ?? 0;

    const mark = await supabase
      .from("institutions")
      .update({ merged_into: survivor.id })
      .in("id", loserIds);
    if (mark.error) throw mark.error;
  }

  // Flag near-duplicate canonical institutions for human review. These are not
  // merged automatically: an institution merge is rare and high-impact, so a
  // person should confirm and add an entry to INSTITUTION_ALIASES.
  const canonical = institutions.filter((i) => !i.merged_into);
  const flagged: string[] = [];
  for (let i = 0; i < canonical.length; i++) {
    for (let j = i + 1; j < canonical.length; j++) {
      const a = canonical[i];
      const b = canonical[j];
      const score = similarity(normalize(a.name), normalize(b.name));
      if (score >= 0.6) {
        flagged.push(
          `  ? "${a.name}" (${a.source}) ~ "${b.name}" (${b.source}) ` +
            `[similarity ${score.toFixed(2)}]`,
        );
      }
    }
  }
  if (flagged.length > 0) {
    console.log(
      "\n[dedup] institution pairs to review (add to INSTITUTION_ALIASES if " +
        "they are the same place):",
    );
    for (const line of flagged) console.log(line);
  }

  return {
    groups: reports,
    rowsMerged,
    artworksRepointed,
    exhibitionsRepointed,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[dedup] ${args.dryRun ? "DRY RUN" : "APPLY"}`);
  const supabase = createAdminClient();

  console.log("\n[dedup] artists");
  const artists = await dedupeArtists(supabase, args);
  console.log(
    `[dedup] artists: ${artists.groups.length} duplicate groups, ` +
      `${artists.rowsMerged} rows folded, ` +
      `${artists.artworksRepointed} artworks repointed`,
  );

  console.log("\n[dedup] institutions");
  const institutions = await dedupeInstitutions(supabase, args);
  console.log(
    `[dedup] institutions: ${institutions.groups.length} duplicate groups, ` +
      `${institutions.rowsMerged} rows folded, ` +
      `${institutions.artworksRepointed} artworks and ` +
      `${institutions.exhibitionsRepointed} exhibitions repointed`,
  );

  if (args.dryRun) {
    console.log("\n[dedup] DRY RUN: nothing was written.");
  } else {
    console.log("\n[dedup] done.");
  }
}

main().catch((err: unknown) => {
  console.error("[dedup] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
