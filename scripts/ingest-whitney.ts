// Ingestion adapter for the Whitney Museum of American Art, New York.
//
// Source: github.com/whitneymuseum/open-access (CC0)
// Two CSVs: artworks.csv + artists.csv. No images are included in the dump;
// this is a metadata-only ingestion (same posture as QAGOMA).
//
// Examples:
//   pnpm ingest:whitney -- --dry-run --limit 10
//   pnpm ingest:whitney -- --limit 800

import { streamCsv } from "./lib/csv-stream";
import { createAdminClient } from "./lib/supabase-admin";
import { yearFromText } from "./lib/year";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "whitney";
const UPSERT_CHUNK = 500;
const RAW_BASE =
  "https://raw.githubusercontent.com/whitneymuseum/open-access/main/";
const ARTWORKS_CSV = RAW_BASE + "artworks.csv";
const ARTISTS_CSV = RAW_BASE + "artists.csv";

interface Args {
  limit: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit") limit = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      "--limit <n> is required (a positive integer).\n" +
        "Example: pnpm ingest:whitney -- --dry-run --limit 10",
    );
  }
  return { limit, dryRun };
}

function clean(value: string | undefined | null): string | null {
  const normalized = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (normalized === "") return null;
  return normalized.replace(/\s*\n\s*/g, "; ").replace(/[ \t]{2,}/g, " ");
}

// Whitney artists use begin_date/end_date numeric columns.
// 0 means "living" or "unknown" -- treat as null.
function yearOrNull(value: string | undefined | null): number | null {
  const v = (value ?? "").trim();
  if (v === "" || v === "0") return null;
  const n = Number(v);
  return Number.isInteger(n) && n !== 0 ? n : null;
}

interface WhitneyArtist {
  id: string;
  wikidata_id: string | null;
  display_name: string;
  birth_year: number | null;
  death_year: number | null;
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
  artist_source_id: string;
}

const WHITNEY_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:whitney",
  name: "Whitney Museum of American Art",
  type: "museum",
  city: "New York",
  country: "United States",
  website: "https://whitney.org",
  source_url: "https://whitney.org/collection",
};

async function loadArtists(): Promise<Map<string, WhitneyArtist>> {
  const artists = new Map<string, WhitneyArtist>();
  await streamCsv(ARTISTS_CSV, (row) => {
    const id = (row.id ?? "").trim();
    if (id === "") return;
    const name = (row.display_name ?? "").trim();
    if (name === "") return;
    const wikidata = (row.wikidata_id ?? "").trim();
    artists.set(id, {
      id,
      wikidata_id: wikidata === "" ? null : wikidata,
      display_name: name,
      birth_year: yearOrNull(row.begin_date),
      death_year: yearOrNull(row.end_date),
    });
  });
  return artists;
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
    `[ingest:whitney] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  console.log("[ingest:whitney] loading artists.csv...");
  const artistsById = await loadArtists();
  console.log(`[ingest:whitney] ${artistsById.size} artists loaded`);

  console.log("[ingest:whitney] streaming artworks.csv...");
  const artworks: MappedArtwork[] = [];
  const seenArtists = new Map<string, WhitneyArtist>();
  let scanned = 0;
  let stopped = false;

  await streamCsv(ARTWORKS_CSV, (row) => {
    if (stopped) return;
    scanned++;
    if (artworks.length >= args.limit) {
      stopped = true;
      return;
    }

    const accession = (row.accession_number ?? "").trim();
    if (accession === "") return;

    const title = clean(row.title);
    if (!title) return;

    // First artist ID wins when multiple are listed (pipe or comma separated).
    const rawIds = (row.artist_ids ?? "").trim();
    if (rawIds === "") return;
    const firstId = rawIds.split(/[|,]/)[0]?.trim() ?? "";
    if (firstId === "") return;

    const artist = artistsById.get(firstId);
    if (!artist) return;

    if (!seenArtists.has(firstId)) {
      seenArtists.set(firstId, artist);
    }

    artworks.push({
      source: SOURCE,
      source_id: accession,
      title,
      date_text: clean(row.display_date),
      date_year: yearFromText(row.display_date),
      medium: clean(row.medium),
      dimensions: clean(row.dimensions),
      credit_line: clean(row.credit_line),
      image_url: null,
      image_license: null,
      source_url: `https://whitney.org/collection/works/${(row.id ?? "").trim()}`,
      artist_source_id: firstId,
    });
  });

  console.log(
    `[ingest:whitney] scanned ${scanned} rows, mapped ${artworks.length} artworks, ` +
      `${seenArtists.size} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:whitney] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(WHITNEY_INSTITUTION, { onConflict: "source,source_id" })
    .select("id")
    .single();
  if (instError) throw new Error(`upsert institution: ${instError.message}`);
  const institutionId = inst.id as string;

  const artistRows = [...seenArtists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.id,
    name: a.display_name,
    birth_year: a.birth_year,
    death_year: a.death_year,
    nationality: null,
    source_url: `https://whitney.org/artists/${a.id}`,
  }));
  const upsertedArtists = await chunkedUpsert(
    supabase,
    "artists",
    artistRows as unknown as Record<string, unknown>[],
    "id,source_id",
  );
  const artistIdBySourceId = new Map<string, string>(
    upsertedArtists.map((row) => [row.source_id as string, row.id as string]),
  );
  console.log(`[ingest:whitney] upserted ${upsertedArtists.length} artists`);

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
  console.log(
    `[ingest:whitney] upserted ${upsertedArtworks.length} artworks`,
  );
  console.log(
    "[ingest:whitney] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:whitney] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
