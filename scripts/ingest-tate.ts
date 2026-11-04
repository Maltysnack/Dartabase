// Ingestion adapter for the Tate (London).
//
// Source: github.com/tategallery/collection (CC0 metadata, ~69k artworks)
// Two CSVs: artwork_data.csv + artist_data.csv.
// Thumbnail URLs in the CSV use http://www.tate.org.uk/art/images/... but
// Tate's CDN has moved; rewrite to https://media.tate.org.uk/art/images/...
//
// Examples:
//   pnpm ingest:tate -- --dry-run --limit 10
//   pnpm ingest:tate -- --limit 800

import { streamCsv } from "./lib/csv-stream";
import { createAdminClient } from "./lib/supabase-admin";
import { yearFromText } from "./lib/year";
import type { SupabaseClient } from "@supabase/supabase-js";
import { flipName, rewriteTateImageUrl } from "./lib/tate-parsers";

const SOURCE = "tate";
const UPSERT_CHUNK = 500;
const RAW_BASE =
  "https://raw.githubusercontent.com/tategallery/collection/master/";
const ARTWORKS_CSV = RAW_BASE + "artwork_data.csv";
const ARTISTS_CSV = RAW_BASE + "artist_data.csv";

// Attribution-role prefixes used in art-historical citations.
const ATTRIBUTION_ROLES: Record<string, string> = {
  after: "After",
  "attributed to": "Attributed to",
  "manner of": "Manner of",
  "pupil of": "Pupil of",
  "formerly attributed to": "Formerly attributed to",
  "studio of": "Studio of",
  "imitator of": "Imitator of",
  "school of": "School of",
  "follower of": "Follower of",
};

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
      "--limit <n> is required.\nExample: pnpm ingest:tate -- --dry-run --limit 10",
    );
  }
  return { limit, dryRun };
}

function clean(value: string | undefined | null): string | null {
  const s = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (s === "") return null;
  return s.replace(/\s*\n\s*/g, "; ").replace(/[ \t]{2,}/g, " ");
}

interface TateArtist {
  id: string;
  name: string; // already flipped
  birth_year: number | null;
  death_year: number | null;
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

const TATE_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:tate",
  name: "Tate",
  type: "museum",
  city: "London",
  country: "United Kingdom",
  website: "https://www.tate.org.uk",
  source_url: "https://www.tate.org.uk/art/collection",
};

async function loadArtists(): Promise<Map<string, TateArtist>> {
  const artists = new Map<string, TateArtist>();
  await streamCsv(ARTISTS_CSV, (row) => {
    const id = (row.id ?? "").trim();
    if (id === "") return;
    const raw = (row.name ?? "").trim();
    if (raw === "") return;
    const name = flipName(raw);
    const url = (row.url ?? "").trim();
    artists.set(id, {
      id,
      name,
      birth_year: yearFromText(row.yearOfBirth),
      death_year: yearFromText(row.yearOfDeath),
      source_url: url === "" ? null : url,
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
    `[ingest:tate] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  console.log("[ingest:tate] loading artists.csv...");
  const artistsById = await loadArtists();
  console.log(`[ingest:tate] ${artistsById.size} artists loaded`);

  console.log("[ingest:tate] streaming artwork_data.csv...");
  const artworks: MappedArtwork[] = [];
  const seenArtists = new Map<string, TateArtist>();
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

    const artistId = (row.artistId ?? "").trim();
    if (artistId === "") return;

    const artist = artistsById.get(artistId);
    if (!artist) return;

    // Skip multi-artist entries (no clean primary attribution).
    const role = (row.artistRole ?? "").trim().toLowerCase();
    if (role === "and other artists") return;

    const prefix = ATTRIBUTION_ROLES[role];
    const artistName = prefix ? `${prefix} ${artist.name}` : artist.name;
    const artistKey = prefix ? `${artistId}:${role}` : artistId;

    if (!seenArtists.has(artistKey)) {
      seenArtists.set(artistKey, { ...artist, id: artistKey, name: artistName });
    }

    const rawThumb = (row.thumbnailUrl ?? "").trim();
    const imageUrl = rewriteTateImageUrl(rawThumb);
    const copyright = (row.thumbnailCopyright ?? "").trim();
    const imageLicense = copyright !== "" ? copyright : imageUrl ? "Tate" : null;

    artworks.push({
      source: SOURCE,
      source_id: accession,
      title,
      date_text: clean(row.dateText),
      date_year: yearFromText(row.year),
      medium: clean(row.medium),
      dimensions: clean(row.dimensions),
      credit_line: clean(row.creditLine),
      image_url: imageUrl,
      image_license: imageLicense,
      source_url: clean(row.url),
      artist_source_id: artistKey,
    });
  });

  console.log(
    `[ingest:tate] scanned ${scanned} rows, mapped ${artworks.length} artworks, ` +
      `${seenArtists.size} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:tate] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(TATE_INSTITUTION, { onConflict: "source,source_id" })
    .select("id")
    .single();
  if (instError) throw new Error(`upsert institution: ${instError.message}`);
  const institutionId = inst.id as string;

  const artistRows = [...seenArtists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.id,
    name: a.name,
    birth_year: a.birth_year,
    death_year: a.death_year,
    nationality: null,
    source_url: a.source_url,
  }));
  const upsertedArtists = await chunkedUpsert(
    supabase,
    "artists",
    artistRows as unknown as Record<string, unknown>[],
    "id,source_id",
  );
  const artistIdByKey = new Map<string, string>(
    upsertedArtists.map((row) => [row.source_id as string, row.id as string]),
  );
  console.log(`[ingest:tate] upserted ${upsertedArtists.length} artists`);

  const artworkInsertRows = artworks.map((artwork) => {
    const { artist_source_id, ...rest } = artwork;
    return {
      ...rest,
      artist_id: artistIdByKey.get(artist_source_id) ?? null,
      current_institution_id: institutionId,
    };
  });
  const upsertedArtworks = await chunkedUpsert(
    supabase,
    "artworks",
    artworkInsertRows as unknown as Record<string, unknown>[],
    "id",
  );
  console.log(`[ingest:tate] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:tate] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:tate] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
