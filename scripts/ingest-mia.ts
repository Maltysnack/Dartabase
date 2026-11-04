// Ingestion adapter for the Minneapolis Institute of Art (Mia).
//
// Mia publishes its catalogue as one JSON file per object in the
// github.com/artsmia/collection repo (CC0). This adapter lists object paths
// via the GitHub git/trees API, then fetches each JSON file from
// raw.githubusercontent.com. Only public-domain, image-bearing, unrestricted
// works are ingested. Upserts key on (source, source_id) with source = 'mia',
// so re-running is idempotent.
//
// Examples:
//   pnpm ingest:mia -- --dry-run --limit 10
//   pnpm ingest:mia -- --limit 800

import { createAdminClient } from "./lib/supabase-admin";
import {
  artistSourceIdFromName,
  parseLifeDate,
  primaryArtistName,
} from "./lib/mia-parsers";
import { yearFromText } from "./lib/year";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "mia";
const UPSERT_CHUNK = 500;
const TREE_API =
  "https://api.github.com/repos/artsmia/collection/git/trees/main?recursive=1";
const RAW_BASE =
  "https://raw.githubusercontent.com/artsmia/collection/main/";
const CONCURRENCY = 6;

interface Args {
  limit: number;
  delayMs: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let delayMs = 80;
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
        "Example: pnpm ingest:mia -- --dry-run --limit 10",
    );
  }
  return { limit, delayMs, dryRun };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function clean(value: string | undefined | null): string | null {
  const normalized = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (normalized === "") return null;
  return normalized.replace(/\s*\n\s*/g, "; ").replace(/[ \t]{2,}/g, " ");
}

// The three MIA-specific text parsers (primaryArtistName,
// artistSourceIdFromName, parseLifeDate) now live in
// scripts/lib/mia-parsers.ts so they can be unit-tested without importing
// this file (which runs main() at the bottom and would trigger a full
// ingestion on import). See scripts/lib/mia-parsers.test.ts for the
// 19-case coverage.

interface MiaObject {
  id?: number | string;
  accession_number?: string;
  title?: string;
  artist?: string;
  dated?: string;
  medium?: string;
  dimension?: string;
  creditline?: string;
  nationality?: string;
  life_date?: string;
  rights_type?: string;
  image?: string;
  restricted?: number;
  object_name?: string;
}

interface GitTreeEntry {
  path: string;
  type: string;
}

interface Artist {
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
  source_url: string | null;
  artist_source_id: string;
}

const MIA_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:mia",
  name: "Minneapolis Institute of Art",
  type: "museum",
  city: "Minneapolis",
  country: "United States",
  website: "https://collections.artsmia.org",
  source_url: "https://collections.artsmia.org",
};

async function listObjectPaths(): Promise<string[]> {
  const res = await fetch(TREE_API);
  if (!res.ok) {
    throw new Error(`tree API ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { tree: GitTreeEntry[]; truncated: boolean };
  const paths = json.tree
    .filter(
      (t) =>
        t.type === "blob" &&
        t.path.startsWith("objects/") &&
        t.path.endsWith(".json") &&
        !t.path.endsWith("/.json"),
    )
    .map((t) => t.path);
  if (json.truncated) {
    console.log(
      `[ingest:mia] note: GitHub tree truncated; using ${paths.length} known paths`,
    );
  }
  return paths;
}

async function fetchObject(path: string): Promise<MiaObject | null> {
  const res = await fetch(RAW_BASE + path);
  if (!res.ok) return null;
  try {
    return (await res.json()) as MiaObject;
  } catch {
    return null;
  }
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

function extractNumericId(object: MiaObject): string | null {
  const raw = object.id;
  if (raw == null) return null;
  const str = String(raw);
  const tail = str.split("/").pop();
  if (!tail) return null;
  return /^\d+$/.test(tail) ? tail : null;
}

function mapObject(object: MiaObject): {
  artwork: MappedArtwork;
  artist: Artist;
} | null {
  if (object.rights_type !== "Public Domain") return null;
  if (object.image !== "valid") return null;
  if (object.restricted !== 0) return null;

  const title = clean(object.title);
  if (!title) return null;

  const accession = (object.accession_number ?? "").trim();
  if (accession === "") return null;

  const numericId = extractNumericId(object);
  if (!numericId) return null;

  const artistName = primaryArtistName(object.artist);
  if (!artistName) return null;

  const artistId = artistSourceIdFromName(artistName);
  if (artistId === "") return null;

  const { nationality, birth, death } = parseLifeDate(object.life_date);

  const artwork: MappedArtwork = {
    source: SOURCE,
    source_id: accession,
    title,
    date_text: clean(object.dated),
    date_year: yearFromText(object.dated),
    medium: clean(object.medium),
    dimensions: clean(object.dimension),
    credit_line: clean(object.creditline),
    image_url: `https://1.api.artsmia.org/800/${numericId}.jpg`,
    image_license: "Minneapolis Institute of Art, CC0",
    source_url: `https://collections.artsmia.org/art/${numericId}`,
    artist_source_id: artistId,
  };

  const artist: Artist = {
    source_id: artistId,
    name: artistName,
    birth_year: birth,
    death_year: death,
    nationality: clean(object.nationality) ?? nationality,
  };

  return { artwork, artist };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[ingest:mia] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  const paths = await listObjectPaths();
  console.log(`[ingest:mia] ${paths.length} object paths from tree`);

  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, Artist>();
  let scanned = 0;
  let i = 0;

  while (artworks.length < args.limit && i < paths.length) {
    const batch = paths.slice(i, i + CONCURRENCY);
    i += CONCURRENCY;
    const objects = await Promise.all(batch.map(fetchObject));
    scanned += batch.length;

    for (const object of objects) {
      if (artworks.length >= args.limit) break;
      if (!object) continue;
      const mapped = mapObject(object);
      if (!mapped) continue;
      artworks.push(mapped.artwork);
      if (!artists.has(mapped.artist.source_id)) {
        artists.set(mapped.artist.source_id, mapped.artist);
      }
    }
    if (args.delayMs > 0) await sleep(args.delayMs);
  }

  const artistRows = [...artists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    name: a.name,
    birth_year: a.birth_year,
    death_year: a.death_year,
    nationality: a.nationality,
    source_url: "https://collections.artsmia.org",
  }));
  console.log(
    `[ingest:mia] scanned ${scanned} records, mapped ${artworks.length} artworks, ` +
      `${artistRows.length} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:mia] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(MIA_INSTITUTION, { onConflict: "source,source_id" })
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
  console.log(`[ingest:mia] upserted ${upsertedArtists.length} artists`);

  const artworkInsertRows = artworks.map((artwork) => {
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
  console.log(`[ingest:mia] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:mia] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:mia] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
