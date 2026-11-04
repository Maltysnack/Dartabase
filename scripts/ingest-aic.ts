// Ingestion adapter for the Art Institute of Chicago.
//
// Modes (default writes straight to Supabase with the service role key):
//   --dry-run          Fetch and map records but write nothing.
//   --emit-sql <path>  Fetch and map, then write an idempotent .sql seed file
//                      instead of touching the database (needs no credentials).
//
// Safety guardrails:
//   --limit <n>   REQUIRED. Hard cap on artworks fetched. No unbounded mode.
//   --page-size   AIC page size (1-100, default 100).
//   --delay-ms    Delay between AIC API calls (default 1000).
//
// Upserts key on (source, source_id), so re-running updates rows in place and
// can never duplicate or balloon the database.
//
// Examples:
//   pnpm ingest:aic -- --dry-run --limit 25
//   pnpm ingest:aic -- --emit-sql /tmp/seed.sql --limit 50
//   pnpm ingest:aic -- --limit 500

import { writeFileSync } from "node:fs";
import { createAdminClient } from "./lib/supabase-admin";
import {
  DEFAULT_IIIF_URL,
  fetchArtistsByIds,
  fetchArtworksPage,
  setRateLimit,
  type AicArtist,
  type AicArtwork,
} from "@/lib/aic-api";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "aic";
const UPSERT_CHUNK = 500;
// Safety cap: never scan more than this many AIC listing pages in one run,
// regardless of how long it takes to satisfy --limit.
const MAX_PAGE_SCAN = 60;

interface Args {
  limit: number;
  pageSize: number;
  delayMs: number;
  dryRun: boolean;
  emitSql: string | null;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let pageSize = 100;
  let delayMs = 1000;
  let dryRun = false;
  let emitSql: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--emit-sql") emitSql = argv[++i] ?? null;
    else if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg === "--page-size") pageSize = Number(argv[++i]);
    else if (arg === "--delay-ms") delayMs = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      "--limit <n> is required (a positive integer). There is no unbounded mode.\n" +
        "Example: pnpm ingest:aic -- --dry-run --limit 25",
    );
  }
  if (emitSql !== null && emitSql.trim() === "") {
    throw new Error("--emit-sql requires a file path.");
  }

  return {
    limit,
    pageSize: Math.min(Math.max(Math.trunc(pageSize), 1), 100),
    delayMs: Math.max(0, Math.trunc(delayMs)),
    dryRun,
    emitSql,
  };
}

// AIC sometimes stores sentinel years (e.g. 4713) for unknown dates.
function saneYear(year: number | null): number | null {
  if (year == null) return null;
  if (year < -3000 || year > new Date().getFullYear()) return null;
  return year;
}

// AIC's "artworks" listing includes archival collections (papers, records).
// They are not artworks and share a generic placeholder image, so skip them.
function isArchival(artwork: AicArtwork): boolean {
  const dept = artwork.department_title?.toLowerCase() ?? "";
  const cls = artwork.classification_title?.toLowerCase() ?? "";
  return dept.includes("archive") || cls.includes("archiv");
}

interface InstitutionRow {
  source: string;
  source_id: string;
  name: string;
  type: string;
  city: string;
  country: string;
  website: string;
  source_url: string;
}

interface ArtistRow {
  source: string;
  source_id: string;
  name: string;
  sort_name: string | null;
  birth_year: number | null;
  death_year: number | null;
  bio: string | null;
  source_url: string;
}

interface MappedArtwork {
  source: string;
  source_id: string;
  title: string;
  date_text: string | null;
  date_year: number | null;
  medium: string | null;
  materials: string[];
  dimensions: string | null;
  credit_line: string | null;
  image_url: string | null;
  image_license: string | null;
  source_url: string;
  artist_source_id: string | null;
  department: string | null;
  classification: string | null;
}

const AIC_INSTITUTION: InstitutionRow = {
  source: SOURCE,
  source_id: "institution:aic",
  name: "Art Institute of Chicago",
  type: "museum",
  city: "Chicago",
  country: "United States",
  website: "https://www.artic.edu",
  source_url: "https://www.artic.edu",
};

function mapArtist(artist: AicArtist): ArtistRow {
  return {
    source: SOURCE,
    source_id: String(artist.id),
    name: artist.title ?? "Unknown artist",
    sort_name: artist.sort_title ?? null,
    birth_year: saneYear(artist.birth_date),
    death_year: saneYear(artist.death_date),
    // The artist page no longer displays source-provided long-form bios; per
    // issue #21 Dartabase carries only short, factual identification computed
    // from structured data. Leaving the column null so re-running this adapter
    // clears any historical editorial copy.
    bio: null,
    source_url: `https://www.artic.edu/artists/${artist.id}`,
  };
}

function mapArtwork(artwork: AicArtwork, iiifUrl: string): MappedArtwork {
  return {
    source: SOURCE,
    source_id: String(artwork.id),
    title: artwork.title ?? "Untitled",
    date_text: artwork.date_display ?? null,
    date_year: artwork.date_start ?? artwork.date_end ?? null,
    medium: artwork.medium_display ?? null,
    materials: artwork.material_titles ?? [],
    dimensions: artwork.dimensions ?? null,
    credit_line: artwork.credit_line ?? null,
    image_url: artwork.image_id
      ? `${iiifUrl}/${artwork.image_id}/full/843,/0/default.jpg`
      : null,
    image_license: artwork.is_public_domain
      ? "Public Domain (CC0)"
      : "Rights reserved (see source)",
    source_url: `https://www.artic.edu/artworks/${artwork.id}`,
    artist_source_id: artwork.artist_id != null ? String(artwork.artist_id) : null,
    department: artwork.department_title ?? null,
    classification: artwork.classification_title ?? null,
  };
}

// --- SQL seed generation (--emit-sql) ---

function sqlText(value: string | null): string {
  if (value == null) return "null";
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlInt(value: number | null): string {
  return value == null ? "null" : String(Math.trunc(value));
}

function sqlTextArray(values: string[]): string {
  if (values.length === 0) return "'{}'::text[]";
  return `array[${values.map(sqlText).join(",")}]::text[]`;
}

// Builds an idempotent SQL seed: institution, artists, then artworks. Artwork
// foreign keys resolve by (source, source_id) subquery, so no generated UUIDs
// need to be known ahead of time.
function buildSeedSql(
  institution: InstitutionRow,
  artists: ArtistRow[],
  artworks: MappedArtwork[],
): string {
  const blocks: string[] = [
    "-- Dartabase seed: Art Institute of Chicago\n" +
      "-- Generated by scripts/ingest-aic.ts --emit-sql. Idempotent; safe to re-run.",
  ];

  blocks.push(
    "insert into institutions (source, source_id, name, type, city, country, website, source_url)\n" +
      `values (${[
        institution.source,
        institution.source_id,
        institution.name,
        institution.type,
        institution.city,
        institution.country,
        institution.website,
        institution.source_url,
      ]
        .map(sqlText)
        .join(", ")})\n` +
      "on conflict (source, source_id) do update set\n" +
      "  name = excluded.name, type = excluded.type, city = excluded.city,\n" +
      "  country = excluded.country, website = excluded.website,\n" +
      "  source_url = excluded.source_url;",
  );

  if (artists.length > 0) {
    const rows = artists.map(
      (a) =>
        `  (${sqlText(a.source)}, ${sqlText(a.source_id)}, ${sqlText(a.name)}, ` +
        `${sqlText(a.sort_name)}, ${sqlInt(a.birth_year)}, ${sqlInt(a.death_year)}, ` +
        `${sqlText(a.bio)}, ${sqlText(a.source_url)})`,
    );
    blocks.push(
      "insert into artists (source, source_id, name, sort_name, birth_year, death_year, bio, source_url)\n" +
        `values\n${rows.join(",\n")}\n` +
        "on conflict (source, source_id) do update set\n" +
        "  name = excluded.name, sort_name = excluded.sort_name,\n" +
        "  birth_year = excluded.birth_year, death_year = excluded.death_year,\n" +
        "  bio = excluded.bio, source_url = excluded.source_url;",
    );
  }

  const artworkValues = artworks.map(
    (a) =>
      `  (${sqlText(a.source)}, ${sqlText(a.source_id)}, ${sqlText(a.title)}, ` +
      `${sqlText(a.date_text)}, ${sqlInt(a.date_year)}, ${sqlText(a.medium)}, ` +
      `${sqlTextArray(a.materials)}, ${sqlText(a.dimensions)}, ` +
      `${sqlText(a.credit_line)}, ${sqlText(a.image_url)}, ` +
      `${sqlText(a.image_license)}, ${sqlText(a.source_url)}, ` +
      `${sqlText(a.artist_source_id)}, ${sqlText(a.department)}, ` +
      `${sqlText(a.classification)})`,
  );
  blocks.push(
    "insert into artworks (\n" +
      "  source, source_id, title, date_text, date_year, medium, materials,\n" +
      "  dimensions, credit_line, image_url, image_license, source_url,\n" +
      "  artist_id, current_institution_id, department, classification)\n" +
      "select\n" +
      "  v.source, v.source_id, v.title, v.date_text, v.date_year::int, v.medium,\n" +
      "  v.materials, v.dimensions, v.credit_line, v.image_url, v.image_license,\n" +
      "  v.source_url,\n" +
      "  (select id from artists a where a.source = 'aic' and a.source_id = v.artist_source_id),\n" +
      "  (select id from institutions i where i.source = 'aic' and i.source_id = 'institution:aic'),\n" +
      "  v.department, v.classification\n" +
      `from (values\n${artworkValues.join(",\n")}\n) as v(\n` +
      "  source, source_id, title, date_text, date_year, medium, materials,\n" +
      "  dimensions, credit_line, image_url, image_license, source_url, artist_source_id,\n" +
      "  department, classification)\n" +
      "on conflict (source, source_id) do update set\n" +
      "  title = excluded.title, date_text = excluded.date_text,\n" +
      "  date_year = excluded.date_year, medium = excluded.medium,\n" +
      "  materials = excluded.materials, dimensions = excluded.dimensions,\n" +
      "  credit_line = excluded.credit_line, image_url = excluded.image_url,\n" +
      "  image_license = excluded.image_license, source_url = excluded.source_url,\n" +
      "  artist_id = excluded.artist_id,\n" +
      "  current_institution_id = excluded.current_institution_id,\n" +
      "  department = excluded.department, classification = excluded.classification;",
  );

  return blocks.join("\n\n") + "\n";
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
  setRateLimit(args.delayMs);

  const mode = args.dryRun ? "DRY RUN" : args.emitSql ? "EMIT SQL" : "LIVE";
  console.log(
    `[ingest:aic] ${mode}: limit=${args.limit} ` +
      `pageSize=${args.pageSize} delay=${args.delayMs}ms`,
  );

  // 1. Fetch artworks, keeping only those with both an artist and an image.
  //    AIC's listing is mostly artist-less decorative objects, so we page
  //    until the hard limit is reached or the page-scan cap is hit.
  const artworks: AicArtwork[] = [];
  let iiifUrl = DEFAULT_IIIF_URL;
  let scanned = 0;
  for (
    let page = 1;
    artworks.length < args.limit && page <= MAX_PAGE_SCAN;
    page++
  ) {
    const res = await fetchArtworksPage(page, args.pageSize);
    iiifUrl = res.config?.iiif_url ?? iiifUrl;
    scanned += res.data.length;
    for (const candidate of res.data) {
      if (
        candidate.artist_id != null &&
        candidate.image_id != null &&
        !isArchival(candidate)
      ) {
        artworks.push(candidate);
        if (artworks.length >= args.limit) break;
      }
    }
    console.log(
      `[ingest:aic] scanned ${scanned}, kept ${artworks.length}/${args.limit} ` +
        `(artworks with an artist and image, archival material excluded)`,
    );
    if (page >= res.pagination.total_pages || res.data.length === 0) break;
  }

  // 2. Fetch the artists those artworks reference.
  const artistIds = [
    ...new Set(
      artworks
        .map((a) => a.artist_id)
        .filter((id): id is number => id != null),
    ),
  ];
  const rawArtists = await fetchArtistsByIds(artistIds);
  console.log(
    `[ingest:aic] fetched ${rawArtists.length} artists for ${artistIds.length} ids`,
  );

  // 3. Map into our schema.
  const artistRows = rawArtists.map(mapArtist);
  const artworkRows = artworks.map((a) => mapArtwork(a, iiifUrl));

  const withImages = artworkRows.filter((a) => a.image_url).length;
  const publicDomain = artworkRows.filter(
    (a) => a.image_license?.startsWith("Public"),
  ).length;
  console.log(
    `[ingest:aic] mapped ${artworkRows.length} artworks, ` +
      `${artistRows.length} artists, 1 institution`,
  );
  console.log(
    `[ingest:aic]   ${withImages} have an image, ${publicDomain} are public domain`,
  );

  if (args.emitSql) {
    const sql = buildSeedSql(AIC_INSTITUTION, artistRows, artworkRows);
    writeFileSync(args.emitSql, sql, "utf8");
    console.log(
      `\n[ingest:aic] wrote idempotent SQL seed to ${args.emitSql} ` +
        `(${sql.length} bytes). No database connection was used.`,
    );
    return;
  }

  if (args.dryRun) {
    console.log(
      "\n[ingest:aic] DRY RUN: no database writes. Sample of 3 mapped artworks:\n",
    );
    for (const sample of artworkRows.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    console.log("\n[ingest:aic] dry run complete.");
    return;
  }

  // 4. Write to the database (LIVE).
  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(AIC_INSTITUTION, { onConflict: "source,source_id" })
    .select("id")
    .single();
  if (instError) throw new Error(`upsert institution: ${instError.message}`);
  const institutionId = inst.id as string;

  const upsertedArtists = await chunkedUpsert(
    supabase,
    "artists",
    artistRows as unknown as Record<string, unknown>[],
    "id,source_id",
  );
  const artistIdBySourceId = new Map<string, string>(
    upsertedArtists.map((r) => [r.source_id as string, r.id as string]),
  );
  console.log(`[ingest:aic] upserted ${upsertedArtists.length} artists`);

  const artworkInsertRows = artworkRows.map((a) => {
    const { artist_source_id, ...rest } = a;
    return {
      ...rest,
      artist_id: artist_source_id
        ? artistIdBySourceId.get(artist_source_id) ?? null
        : null,
      current_institution_id: institutionId,
    };
  });
  const upsertedArtworks = await chunkedUpsert(
    supabase,
    "artworks",
    artworkInsertRows as unknown as Record<string, unknown>[],
    "id",
  );
  console.log(`[ingest:aic] upserted ${upsertedArtworks.length} artworks`);
  console.log("[ingest:aic] done.");
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:aic] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
