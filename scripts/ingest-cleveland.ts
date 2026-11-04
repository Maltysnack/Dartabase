// Ingestion adapter for the Cleveland Museum of Art.
//
// Pulls public-domain artworks (with an image and a named creator) from the
// Open Access API and writes them directly with the service role key.
//
// Examples:
//   pnpm ingest:cleveland -- --dry-run --limit 10
//   pnpm ingest:cleveland -- --limit 400

import { createAdminClient } from "./lib/supabase-admin";
import {
  fetchArtworksPage,
  setRateLimit,
  type ClevelandArtwork,
} from "./lib/cleveland-api";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "cleveland";
const UPSERT_CHUNK = 500;
const PAGE_SIZE = 100;

interface Args {
  limit: number;
  delayMs: number;
  maxScan: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let delayMs = 150;
  let maxScan = 8000;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg === "--delay-ms") delayMs = Number(argv[++i]);
    else if (arg === "--max-scan") maxScan = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      "--limit <n> is required (a positive integer).\n" +
        "Example: pnpm ingest:cleveland -- --dry-run --limit 10",
    );
  }
  return {
    limit,
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

// Cleveland creator descriptions look like "William Merritt Chase (American,
// 1849–1916)". Pull the name and, where present, the nationality.
function parseCreator(description: string): {
  name: string;
  nationality: string | null;
} {
  const parenIndex = description.indexOf(" (");
  if (parenIndex === -1) {
    return { name: description.trim(), nationality: null };
  }
  const name = description.slice(0, parenIndex).trim();
  const inside = description.slice(parenIndex + 2).replace(/\)\s*$/, "");
  const first = inside.split(",")[0].trim();
  const nationality = first !== "" && !/\d/.test(first) ? first : null;
  return { name: name || description.trim(), nationality };
}

interface ArtistRow {
  source: string;
  source_id: string;
  name: string;
  birth_year: number | null;
  death_year: number | null;
  nationality: string | null;
  source_url: string;
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
  image_license: string;
  source_url: string | null;
  artist_source_id: string;
}

const CLEVELAND_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:cleveland",
  name: "Cleveland Museum of Art",
  type: "museum",
  city: "Cleveland",
  country: "United States",
  website: "https://www.clevelandart.org",
  source_url: "https://www.clevelandart.org",
};

// Keep artworks that have an image and a creator with a stable id.
function primaryCreator(artwork: ClevelandArtwork) {
  return (artwork.creators ?? []).find(
    (creator) => creator.id != null && creator.description,
  );
}

function isWanted(artwork: ClevelandArtwork): boolean {
  return Boolean(artwork.images?.web?.url) && primaryCreator(artwork) != null;
}

function mapArtist(artwork: ClevelandArtwork): ArtistRow {
  const creator = primaryCreator(artwork)!;
  const parsed = parseCreator(creator.description ?? "");
  return {
    source: SOURCE,
    source_id: String(creator.id),
    name: parsed.name || "Unknown artist",
    birth_year: parseYear(creator.birth_year),
    death_year: parseYear(creator.death_year),
    nationality: parsed.nationality,
    source_url: "https://www.clevelandart.org",
  };
}

function mapArtwork(artwork: ClevelandArtwork): MappedArtwork {
  const creator = primaryCreator(artwork)!;
  return {
    source: SOURCE,
    source_id: String(artwork.id),
    title:
      artwork.title && artwork.title.trim() !== ""
        ? artwork.title
        : "Untitled",
    date_text: artwork.creation_date ?? null,
    date_year: saneYear(artwork.sortable_date),
    medium: artwork.technique ?? null,
    dimensions: artwork.measurements ?? null,
    credit_line: artwork.creditline ?? null,
    image_url: artwork.images?.web?.url ?? null,
    image_license: "Public Domain (CC0)",
    source_url: artwork.url ?? null,
    artist_source_id: String(creator.id),
  };
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
    `[ingest:cleveland] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  const kept: ClevelandArtwork[] = [];
  let scanned = 0;
  for (let skip = 0; kept.length < args.limit && scanned < args.maxScan; ) {
    const { total, data } = await fetchArtworksPage(skip, PAGE_SIZE);
    if (data.length === 0) break;
    for (const artwork of data) {
      scanned++;
      if (isWanted(artwork)) kept.push(artwork);
      if (kept.length >= args.limit) break;
    }
    console.log(
      `[ingest:cleveland] scanned ${scanned}, kept ${kept.length}/${args.limit}`,
    );
    skip += PAGE_SIZE;
    if (skip >= total) break;
  }
  console.log(`[ingest:cleveland] kept ${kept.length} artworks`);

  const artistsById = new Map<string, ArtistRow>();
  for (const artwork of kept) {
    const artist = mapArtist(artwork);
    if (!artistsById.has(artist.source_id)) {
      artistsById.set(artist.source_id, artist);
    }
  }
  const artistRows = [...artistsById.values()];
  const artworkRows = kept.map(mapArtwork);
  console.log(
    `[ingest:cleveland] mapped ${artworkRows.length} artworks, ` +
      `${artistRows.length} artists, 1 institution`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:cleveland] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworkRows.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(CLEVELAND_INSTITUTION, { onConflict: "source,source_id" })
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
  console.log(`[ingest:cleveland] upserted ${upsertedArtists.length} artists`);

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
  console.log(`[ingest:cleveland] upserted ${upsertedArtworks.length} artworks`);
  console.log("[ingest:cleveland] done.");
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:cleveland] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
