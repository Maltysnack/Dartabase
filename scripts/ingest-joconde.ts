// Ingestion adapter for Joconde, the French national museum catalog.
// 700k+ records from museums across France. Metadata only (no images).
//
// API: https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/base-joconde-extrait/records
// No API key required. Open government data.
//
// Filters applied: auteur is not null, titre is not null, auteur != 'anonyme'.
// This gives named works with titled entries. Most records lack images; the
// presence_image flag signals an image exists in the Joconde database but
// URLs are not exposed via the open data API.
//
// Run:
//   pnpm ingest:joconde -- --dry-run --limit 10
//   pnpm ingest:joconde -- --limit 500

import { createAdminClient } from "./lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "joconde";
const UPSERT_CHUNK = 500;
const PAGE_SIZE = 100;
const API_BASE =
  "https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/base-joconde-extrait/records";

// Filter: require both author and title fields to be present.
// Anonymous records are filtered out in code (ODS doesn't support NOT LIKE).
const WHERE = "auteur is not null and titre is not null";

interface Args {
  limit: number;
  delayMs: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let delayMs = 150;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg === "--delay-ms") delayMs = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      "--limit <n> is required (a positive integer).\n" +
        "Example: pnpm ingest:joconde -- --dry-run --limit 10",
    );
  }
  return { limit, delayMs, dryRun };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface JocondeRecord {
  reference: string;
  titre: string | null;
  auteur: string | null;
  periode_de_creation: string | null;
  materiaux_techniques: string[] | null;
  mesures: string | null;
  nom_officiel_musee: string | null;
  ville: string | null;
  region: string | null;
  code_museofile: string | null;
  ecole_pays: string | null;
  lien_site_associe: string | null;
  presence_image: string | null;
  statut_juridique: string | null;
}

interface JocondeResponse {
  total_count: number;
  results: JocondeRecord[];
}

interface MappedArtist {
  name: string;
  nationality: string | null;
}

interface MappedArtwork {
  source: string;
  source_id: string;
  title: string;
  date_text: string | null;
  date_year: number | null;
  medium: string | null;
  dimensions: string | null;
  credit_line: string | null;
  image_url: null;
  image_license: null;
  source_url: string | null;
  artist_key: string;
  institution_key: string;
}

interface MappedInstitution {
  source: string;
  source_id: string;
  name: string;
  type: string;
  city: string | null;
  country: string;
  website: string | null;
  source_url: string;
}

// Parse a Joconde auteur string to a display name.
// Format variants:
//   "PEYNOT Emile Edmond (dessinateur)"
//   "BACICCIO (dit);GAULLI Giovanni Battista (peintre)"
//   "anonyme;TEMPESTA Antonio (peintre, genre de)"
//   "Kogetsu"
// Returns the best non-anonymous name, converted to "Firstname Lastname" form.
function parseAuthor(raw: string): string | null {
  // Split multiple authors on ";" and take the last non-anonymous one.
  const parts = raw.split(";");
  let best: string | null = null;
  for (const part of parts) {
    const name = part.trim();
    if (/^anonyme/i.test(name)) continue;
    best = name;
  }
  if (!best) return null;

  // Strip role annotation in parentheses at the end: "PEYNOT Emile (peintre)" -> "PEYNOT Emile"
  const withoutRole = best.replace(/\s*\([^)]*\)\s*$/, "").trim();

  // Check if it's in "LASTNAME Firstname" format (first token is all caps and >1 char).
  const tokens = withoutRole.split(/\s+/);
  if (
    tokens.length >= 2 &&
    tokens[0] === tokens[0].toUpperCase() &&
    tokens[0].length > 1 &&
    /^[A-Z]/.test(tokens[0])
  ) {
    // Reorder: join everything after the first token, then the last name (title-cased)
    const lastName = tokens[0].slice(0, 1) + tokens[0].slice(1).toLowerCase();
    const firstName = tokens.slice(1).join(" ");
    return `${firstName} ${lastName}`.trim();
  }

  return withoutRole;
}

// Extract the first URL from a semicolon-or-comma-separated lien_site_associe value.
function parseSourceUrl(raw: string | null): string | null {
  if (!raw) return null;
  const urls = raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const url = urls.find((u) => u.startsWith("http"));
  return url ?? null;
}

// Infer a rough year from a French period string.
// E.g. "20e siècle" -> 1950 (midpoint), "3e quart 19e siècle" -> 1875
// Returns null if unparseable.
function inferYear(period: string | null): number | null {
  if (!period) return null;
  const s = period.trim().toLowerCase();

  // Try to extract a 4-digit year first.
  const exact = s.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  if (exact) return Number.parseInt(exact[1], 10);

  // Map French century ordinals to century start.
  const centuryMatch = s.match(/(\d+)e\s+si[eè]cle/);
  if (!centuryMatch) return null;
  const century = Number.parseInt(centuryMatch[1], 10);
  const centuryStart = (century - 1) * 100;

  // Quarter qualifiers.
  if (/1er\s+quart/.test(s)) return centuryStart + 12;
  if (/2e\s+quart/.test(s)) return centuryStart + 37;
  if (/3e\s+quart/.test(s)) return centuryStart + 62;
  if (/4e\s+quart/.test(s)) return centuryStart + 87;
  if (/1(?:ère|ere|re)?\s+moiti[eé]/.test(s) || /1(?:ère|ere|re)?\s+demi/.test(s))
    return centuryStart + 25;
  if (/2e\s+moiti[eé]/.test(s) || /2e\s+demi/.test(s)) return centuryStart + 75;

  // Default: midpoint of century.
  return centuryStart + 50;
}

// Institution source_id: prefer museofile code, else slugify museum + city.
function institutionKey(record: JocondeRecord): string {
  if (record.code_museofile) return `museofile:${record.code_museofile}`;
  const name = (record.nom_officiel_musee ?? "unknown").replace(/\s+/g, "_");
  const city = (record.ville ?? "").replace(/\s+/g, "_");
  return `${name}:${city}`;
}

// Parse ecole_pays to extract primary nationality.
function parseNationality(raw: string | null): string | null {
  if (!raw) return null;
  // Format: "France;Hollande (?)" or "France" -- take first, strip "(?)".
  const first = raw.split(";")[0].replace(/\s*\([^)]*\)/g, "").trim();
  if (!first || first.toLowerCase() === "inconnu") return null;
  return first;
}

async function chunkedUpsert(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  select: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { data, error } = await supabase
      .from(table)
      .upsert(chunk, { onConflict: "source,source_id" })
      .select(select);
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Record<string, unknown>[]));
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[ingest:joconde] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, MappedArtist>();
  const institutions = new Map<string, MappedInstitution>();
  let offset = 0;
  let totalCount = 0;

  while (artworks.length < args.limit) {
    const url = `${API_BASE}?limit=${PAGE_SIZE}&offset=${offset}&where=${encodeURIComponent(WHERE)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Joconde API ${res.status} at offset ${offset}`);

    const json = (await res.json()) as JocondeResponse;
    if (totalCount === 0) totalCount = json.total_count;
    if (!json.results || json.results.length === 0) break;

    for (const record of json.results) {
      if (artworks.length >= args.limit) break;

      const ref = record.reference?.trim();
      if (!ref) continue;

      const title = record.titre?.trim();
      if (!title) continue;

      const authorName = parseAuthor(record.auteur ?? "");
      if (!authorName) continue;

      const artistKey = authorName.toLowerCase();
      if (!artists.has(artistKey)) {
        artists.set(artistKey, {
          name: authorName,
          nationality: parseNationality(record.ecole_pays),
        });
      }

      const instKey = institutionKey(record);
      if (!institutions.has(instKey)) {
        const musName = record.nom_officiel_musee ?? "French museum";
        institutions.set(instKey, {
          source: SOURCE,
          source_id: instKey,
          name: musName.charAt(0).toUpperCase() + musName.slice(1),
          type: "museum",
          city: record.ville ?? null,
          country: "France",
          website: null,
          source_url: "https://data.culture.gouv.fr",
        });
      }

      const period = record.periode_de_creation;
      const dateText = period ? period.trim() : null;
      const dateYear = inferYear(period);

      const materials = record.materiaux_techniques ?? [];
      const medium = materials.length > 0 ? materials.join("; ") : null;

      artworks.push({
        source: SOURCE,
        source_id: ref,
        title,
        date_text: dateText,
        date_year: dateYear,
        medium,
        dimensions: record.mesures ?? null,
        credit_line: null,
        image_url: null,
        image_license: null,
        source_url: parseSourceUrl(record.lien_site_associe),
        artist_key: artistKey,
        institution_key: instKey,
      });
    }

    offset += PAGE_SIZE;
    if (offset >= totalCount) break;
    await sleep(args.delayMs);
  }

  console.log(
    `[ingest:joconde] mapped ${artworks.length} artworks, ` +
      `${artists.size} artists, ${institutions.size} institutions`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:joconde] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    console.log("\nSample institutions:");
    let n = 0;
    for (const inst of institutions.values()) {
      if (n++ >= 3) break;
      console.log(JSON.stringify(inst, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  // Upsert institutions.
  const institutionRows = [...institutions.values()] as unknown as Record<
    string,
    unknown
  >[];
  const upsertedInstitutions = await chunkedUpsert(
    supabase,
    "institutions",
    institutionRows,
    "id,source_id",
  );
  const institutionIdByKey = new Map<string, string>(
    upsertedInstitutions.map((row) => [
      row.source_id as string,
      row.id as string,
    ]),
  );
  console.log(
    `[ingest:joconde] upserted ${upsertedInstitutions.length} institutions`,
  );

  // Upsert artists.
  const artistRows = [...artists.entries()].map(([key, a]) => ({
    source: SOURCE,
    source_id: `artist:${key}`,
    name: a.name,
    nationality: a.nationality,
    source_url: "https://www.pop.culture.gouv.fr",
  }));
  const upsertedArtists = await chunkedUpsert(
    supabase,
    "artists",
    artistRows as unknown as Record<string, unknown>[],
    "id,source_id",
  );
  const artistIdByKey = new Map<string, string>(
    upsertedArtists.map((row) => {
      const sourceId = row.source_id as string;
      const key = sourceId.startsWith("artist:") ? sourceId.slice(7) : sourceId;
      return [key, row.id as string];
    }),
  );
  console.log(`[ingest:joconde] upserted ${upsertedArtists.length} artists`);

  // Upsert artworks.
  const artworkInsertRows = artworks.map((a) => {
    const { artist_key, institution_key, ...rest } = a;
    return {
      ...rest,
      artist_id: artistIdByKey.get(artist_key) ?? null,
      current_institution_id:
        institutionIdByKey.get(institution_key) ?? null,
    };
  });
  const upsertedArtworks = await chunkedUpsert(
    supabase,
    "artworks",
    artworkInsertRows as unknown as Record<string, unknown>[],
    "id",
  );
  console.log(`[ingest:joconde] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:joconde] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:joconde] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
