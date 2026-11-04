// Ingestion adapter for The Metropolitan Museum of Art.
//
// Fetches public-domain artworks (with an image and a named artist) from a Met
// department and upserts them into Supabase, writing directly with the service
// role key.
//
// Guardrails:
//   --limit <n>   REQUIRED. Hard cap on artworks ingested.
//   --department  Met department id (default 11, European Paintings).
//   --max-scan    Cap on objects fetched in one run (default 4000).
//   --delay-ms    Delay between Met API calls (default 80).
//   --dry-run     Fetch and map but write nothing.
//
// Upserts key on (source, source_id), so re-running updates rows in place.
//
// Examples:
//   pnpm ingest:met -- --dry-run --limit 10
//   pnpm ingest:met -- --limit 300

import { createAdminClient } from "./lib/supabase-admin";
import {
  fetchDepartmentObjectIDs,
  fetchObject,
  setRateLimit,
  type MetObject,
} from "./lib/met-api";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "met";
const UPSERT_CHUNK = 500;

interface Args {
  limit: number;
  department: number;
  delayMs: number;
  maxScan: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let department = 11; // European Paintings
  let delayMs = 80;
  let maxScan = 4000;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg === "--department") department = Number(argv[++i]);
    else if (arg === "--delay-ms") delayMs = Number(argv[++i]);
    else if (arg === "--max-scan") maxScan = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      "--limit <n> is required (a positive integer).\n" +
        "Example: pnpm ingest:met -- --dry-run --limit 10",
    );
  }
  return {
    limit,
    department: Number.isInteger(department) ? department : 11,
    delayMs: Math.max(0, Math.trunc(delayMs)),
    maxScan: Math.max(1, Math.trunc(maxScan)),
    dryRun,
  };
}

function saneYear(year: number | null): number | null {
  if (year == null || !Number.isFinite(year)) return null;
  if (year < -3000 || year > new Date().getFullYear()) return null;
  return year;
}

function parseYear(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/-?\d{1,4}/);
  return match ? saneYear(Number(match[0])) : null;
}

function qidFrom(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/Q\d+/);
  return match ? match[0] : null;
}

interface ArtistRow {
  source: string;
  source_id: string;
  name: string;
  birth_year: number | null;
  death_year: number | null;
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
  image_url: string | null;
  image_license: string | null;
  wikidata_id: string | null;
  source_url: string | null;
  artist_source_id: string;
}

const MET_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:met",
  name: "The Metropolitan Museum of Art",
  type: "museum",
  city: "New York",
  country: "United States",
  website: "https://www.metmuseum.org",
  source_url: "https://www.metmuseum.org",
};

// The Met has no stable artist id on the object, but its constituents array
// does. Fall back to a name key when an object has no constituents.
function artistKey(object: MetObject): string {
  const constituent = object.constituents?.find(
    (entry) => entry.constituentID != null,
  );
  if (constituent) return String(constituent.constituentID);
  return `name:${(object.artistDisplayName ?? "").toLowerCase().trim()}`;
}

function mapArtist(object: MetObject): ArtistRow {
  return {
    source: SOURCE,
    source_id: artistKey(object),
    name: object.artistDisplayName ?? "Unknown artist",
    birth_year: parseYear(object.artistBeginDate),
    death_year: parseYear(object.artistEndDate),
    nationality:
      object.artistNationality && object.artistNationality.trim() !== ""
        ? object.artistNationality
        : null,
  };
}

function mapArtwork(object: MetObject): MappedArtwork {
  return {
    source: SOURCE,
    source_id: String(object.objectID),
    title:
      object.title && object.title.trim() !== "" ? object.title : "Untitled",
    date_text: object.objectDate ?? null,
    date_year: saneYear(object.objectBeginDate),
    medium: object.medium ?? null,
    dimensions: object.dimensions ?? null,
    credit_line: object.creditLine ?? null,
    image_url: object.primaryImageSmall || object.primaryImage || null,
    image_license: object.isPublicDomain
      ? "Public Domain (CC0)"
      : "Rights reserved (see source)",
    wikidata_id: qidFrom(object.objectWikidata_URL),
    source_url: object.objectURL ?? null,
    artist_source_id: artistKey(object),
  };
}

// Keep public-domain works that have both an image and a named artist.
function isWanted(object: MetObject): boolean {
  return (
    object.isPublicDomain === true &&
    Boolean(object.primaryImageSmall || object.primaryImage) &&
    Boolean(object.artistDisplayName && object.artistDisplayName.trim() !== "")
  );
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

  console.log(
    `[ingest:met] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit} ` +
      `department=${args.department} delay=${args.delayMs}ms`,
  );

  const objectIds = await fetchDepartmentObjectIDs(args.department);
  console.log(
    `[ingest:met] department ${args.department} lists ${objectIds.length} objects`,
  );

  const kept: MetObject[] = [];
  let scanned = 0;
  let failed = 0;
  for (const id of objectIds) {
    if (kept.length >= args.limit || scanned >= args.maxScan) break;
    scanned++;
    try {
      const object = await fetchObject(id);
      if (isWanted(object)) kept.push(object);
    } catch {
      // Fetch failed even after retries; count it rather than hide it.
      failed++;
    }
    if (scanned % 50 === 0) {
      console.log(
        `[ingest:met] scanned ${scanned}, kept ${kept.length}/${args.limit}, ` +
          `${failed} failed`,
      );
    }
  }
  console.log(
    `[ingest:met] scanned ${scanned}, kept ${kept.length}, ${failed} failed ` +
      `(kept = public-domain works with an image and a named artist)`,
  );

  const artistsById = new Map<string, ArtistRow>();
  for (const object of kept) {
    const artist = mapArtist(object);
    if (!artistsById.has(artist.source_id)) {
      artistsById.set(artist.source_id, artist);
    }
  }
  const artistRows = [...artistsById.values()];
  const artworkRows = kept.map(mapArtwork);
  console.log(
    `[ingest:met] mapped ${artworkRows.length} artworks, ` +
      `${artistRows.length} artists, 1 institution`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:met] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworkRows.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(MET_INSTITUTION, { onConflict: "source,source_id" })
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
    upsertedArtists.map((row) => [row.source_id as string, row.id as string]),
  );
  console.log(`[ingest:met] upserted ${upsertedArtists.length} artists`);

  const artworkInsertRows = artworkRows.map((artwork) => {
    const { artist_source_id, ...rest } = artwork;
    return {
      ...rest,
      artist_id: artistIdBySourceId.get(artist_source_id) ?? null,
      current_institution_id: institutionId,
    };
  });
  const upsertedArtworks = await chunkedUpsert(
    supabase,
    "artworks",
    artworkInsertRows as unknown as Record<string, unknown>[],
    "id",
  );
  console.log(`[ingest:met] upserted ${upsertedArtworks.length} artworks`);
  console.log("[ingest:met] done.");
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:met] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
