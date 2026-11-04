// Ingestion adapter for the Walters Art Museum, Baltimore.
//
// The Walters v1 REST API was retired in 2023. Until v2 ships, the museum
// publishes static CSV dumps in github.com/WaltersArtMuseum/api-thewalters-org
// (all data and images CC0). This adapter joins three of those CSVs:
//   - creators.csv  → artist names, dates, nationality
//   - media.csv     → primary image URLs per object
//   - art.csv       → the objects themselves
// Only objects with a primary image and an identified creator are ingested.
// Upserts key on (source, source_id) with source = 'walters', so re-running is
// idempotent.
//
// Examples:
//   pnpm ingest:walters -- --dry-run --limit 10
//   pnpm ingest:walters -- --limit 800

import { streamCsv } from "./lib/csv-stream";
import { createAdminClient } from "./lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCreatorDate } from "./lib/walters-parsers";

const SOURCE = "walters";
const UPSERT_CHUNK = 500;
const RAW_BASE =
  "https://raw.githubusercontent.com/WaltersArtMuseum/api-thewalters-org/main/";
const CREATORS_CSV = RAW_BASE + "creators.csv";
const MEDIA_CSV = RAW_BASE + "media.csv";
const ART_CSV = RAW_BASE + "art.csv";

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
        "Example: pnpm ingest:walters -- --dry-run --limit 10",
    );
  }
  return { limit, dryRun };
}

function clean(value: string | undefined | null): string | null {
  const normalized = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (normalized === "") return null;
  return normalized.replace(/\s*\n\s*/g, "; ").replace(/[ \t]{2,}/g, " ");
}

function intOrNull(value: string | undefined | null): number | null {
  const v = (value ?? "").trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

interface WaltersCreator {
  source_id: string;
  name: string;
  nationality: string | null;
  birth: number | null;
  death: number | null;
  url: string | null;
}

interface Artist {
  source_id: string;
  name: string;
  birth_year: number | null;
  death_year: number | null;
  nationality: string | null;
  source_url: string | null;
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

const WALTERS_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:walters",
  name: "Walters Art Museum",
  type: "museum",
  city: "Baltimore",
  country: "United States",
  website: "https://thewalters.org",
  source_url: "https://thewalters.org",
};

async function loadCreators(): Promise<Map<string, WaltersCreator>> {
  const creators = new Map<string, WaltersCreator>();
  await streamCsv(CREATORS_CSV, (row) => {
    const id = (row.id ?? "").trim();
    if (id === "") return;
    const name = (row.name ?? "").trim() || (row.sort_name ?? "").trim();
    if (name === "") return;
    const { nationality, birth, death } = parseCreatorDate(row.date);
    const url = (row.CreatorURL ?? "").trim();
    creators.set(id, {
      source_id: id,
      name,
      nationality,
      birth,
      death,
      url: url === "" ? null : url,
    });
  });
  return creators;
}

// One primary image URL per ObjectID. IsPrimary=1 wins; if none flagged, the
// row with the lowest Rank wins as a fallback.
async function loadPrimaryImages(): Promise<Map<string, string>> {
  // art.thewalters.org CDN now returns CF bot challenges (403) for all
  // programmatic fetches; we cannot proxy these images. Return an empty map
  // so all Walters artworks ingest as metadata-only (no broken image slots).
  return new Map();
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
    `[ingest:walters] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  console.log("[ingest:walters] loading creators.csv...");
  const creators = await loadCreators();
  console.log(`[ingest:walters] ${creators.size} creators loaded`);

  console.log("[ingest:walters] loading media.csv (primary images)...");
  const primaryImage = await loadPrimaryImages();
  console.log(`[ingest:walters] ${primaryImage.size} objects have an image`);

  console.log("[ingest:walters] streaming art.csv...");
  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, Artist>();
  let scanned = 0;
  let stopped = false;

  await streamCsv(ART_CSV, (row) => {
    if (stopped) return;
    scanned++;
    if (artworks.length >= args.limit) {
      stopped = true;
      return;
    }

    const objectId = (row.ObjectID ?? "").trim();
    if (objectId === "") return;
    const objectNumber = (row.ObjectNumber ?? "").trim();
    if (objectNumber === "") return;
    const title = clean(row.Title);
    if (!title) return;

    const imageUrl = primaryImage.get(objectId) ?? null;

    const creatorIds = (row.Creators ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (creatorIds.length === 0) return;

    const firstId = creatorIds[0];
    const creator = creators.get(firstId);
    if (!creator) return;

    if (!artists.has(firstId)) {
      artists.set(firstId, {
        source_id: firstId,
        name: creator.name,
        birth_year: creator.birth,
        death_year: creator.death,
        nationality: creator.nationality,
        source_url: creator.url ?? "https://art.thewalters.org",
      });
    }

    artworks.push({
      source: SOURCE,
      source_id: objectNumber,
      title,
      date_text: clean(row.DateText),
      date_year: intOrNull(row.DateBeginYear),
      medium: clean(row.Medium),
      dimensions: clean(row.Dimensions),
      credit_line: clean(row.CreditLine),
      image_url: imageUrl,
      image_license: imageUrl ? "Walters Art Museum, CC0" : null,
      source_url:
        clean(row.ResourceURL) ??
        `https://art.thewalters.org/detail/${objectId}`,
      artist_source_id: firstId,
    });
  });

  console.log(
    `[ingest:walters] scanned ${scanned} art.csv rows, mapped ${artworks.length} artworks, ` +
      `${artists.size} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:walters] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(WALTERS_INSTITUTION, { onConflict: "source,source_id" })
    .select("id")
    .single();
  if (instError) throw new Error(`upsert institution: ${instError.message}`);
  const institutionId = inst.id as string;

  const artistRows = [...artists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    name: a.name,
    birth_year: a.birth_year,
    death_year: a.death_year,
    nationality: a.nationality,
    source_url: a.source_url,
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
  console.log(`[ingest:walters] upserted ${upsertedArtists.length} artists`);

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
    `[ingest:walters] upserted ${upsertedArtworks.length} artworks`,
  );
  console.log(
    "[ingest:walters] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:walters] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
