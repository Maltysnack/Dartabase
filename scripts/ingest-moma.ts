// Ingestion adapter for the Museum of Modern Art (MoMA), New York.
//
// Reads MoMA's open-data CSVs (CC0) from GitHub: Artworks.csv and Artists.csv.
// Artworks.csv is large, so both files are streamed. MoMA publishes a thumbnail
// URL only for works it can show (out of copyright or licensed); for the many
// in-copyright modern works the image is absent and the record links out.
//
// Upserts key on (source, source_id) with source = 'moma', so re-running is
// idempotent. MoMA's artist records carry Wikidata QIDs, which we keep for the
// dedup pass.
//
// Examples:
//   pnpm ingest:moma -- --dry-run --limit 10
//   pnpm ingest:moma -- --limit 800

import { createAdminClient } from "./lib/supabase-admin";
import { streamCsv } from "./lib/csv-stream";
import { yearFromText } from "./lib/year";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "moma";
const UPSERT_CHUNK = 500;
// MoMA stores the CSVs with Git LFS, so the plain raw.githubusercontent.com URL
// returns only a pointer file. The media endpoint serves the real content.
const REPO_RAW =
  "https://media.githubusercontent.com/media/MuseumofModernArt/collection/main";

// Classifications we treat as artworks. MoMA's collection also holds design,
// architecture, film, and archival material, which we skip.
const ARTWORK_CLASSES = new Set([
  "painting",
  "sculpture",
  "drawing",
  "print",
  "photograph",
]);

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
        "Example: pnpm ingest:moma -- --dry-run --limit 10",
    );
  }
  return { limit, dryRun };
}

// Trim and flatten any multi-line value into one readable line.
function clean(value: string | undefined): string | null {
  const normalized = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (normalized === "") return null;
  return normalized.replace(/\s*\n\s*/g, "; ").replace(/[ \t]{2,}/g, " ");
}

// A plain integer year column. MoMA uses 0 / blank for "unknown".
function yearFromInt(value: string | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n !== 0 ? n : null;
}

// A year out of free text like "1976-77" or "c. 1900".
// Reduce a Wikidata value (a bare QID or an entity URL) to the QID.
function toQid(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/Q\d+/);
  return match ? match[0] : null;
}

// MoMA's Artworks.csv ConstituentID column lists one or more ids; take the
// first as the primary maker.
function firstConstituentId(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\d+/);
  return match ? match[0] : null;
}

interface Artist {
  source_id: string;
  name: string;
  bio: string | null;
  nationality: string | null;
  birth_year: number | null;
  death_year: number | null;
  wikidata_id: string | null;
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

const MOMA_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:moma",
  name: "The Museum of Modern Art",
  type: "museum",
  city: "New York",
  country: "United States",
  website: "https://www.moma.org",
  source_url: "https://www.moma.org",
};

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
    `[ingest:moma] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  // 1. Artist records, keyed by constituent id.
  console.log("[ingest:moma] streaming Artists.csv...");
  const artists = new Map<string, Artist>();
  await streamCsv(`${REPO_RAW}/Artists.csv`, (row) => {
    const id = (row.ConstituentID ?? "").trim();
    const name = (row.DisplayName ?? "").trim();
    if (id === "" || name === "") return;
    artists.set(id, {
      source_id: id,
      name,
      bio: clean(row.ArtistBio),
      nationality: clean(row.Nationality),
      birth_year: yearFromInt(row.BeginDate),
      death_year: yearFromInt(row.EndDate),
      wikidata_id: toQid(row["Wiki QID"]),
    });
  });
  console.log(`[ingest:moma] ${artists.size} artists`);

  // 2. Artworks. Stream and collect up to the limit.
  console.log("[ingest:moma] streaming Artworks.csv...");
  const artworks: MappedArtwork[] = [];
  const usedArtists = new Set<string>();
  await streamCsv(`${REPO_RAW}/Artworks.csv`, (row) => {
    if (artworks.length >= args.limit) return;
    if (!ARTWORK_CLASSES.has((row.Classification ?? "").toLowerCase())) return;
    const title = (row.Title ?? "").trim();
    const objectId = (row.ObjectID ?? "").trim();
    if (title === "" || objectId === "") return;

    const cid = firstConstituentId(row.ConstituentID);
    if (!cid) return;
    const artist = artists.get(cid);
    if (!artist) return;
    usedArtists.add(cid);

    // Image-first policy: MoMA publishes a thumbnail only for works it can
    // show publicly; skip records without one.
    const image = clean(row.ThumbnailURL) ?? clean(row.ImageURL);
    if (!image) return;

    artworks.push({
      source: SOURCE,
      source_id: objectId,
      title,
      date_text: clean(row.Date),
      date_year: yearFromText(row.Date),
      medium: clean(row.Medium),
      dimensions: clean(row.Dimensions),
      credit_line: clean(row.CreditLine),
      image_url: image,
      image_license: "The Museum of Modern Art (see source)",
      source_url: clean(row.URL),
      artist_source_id: cid,
    });
  });

  const artistRows = [...usedArtists].map((cid) => {
    const a = artists.get(cid) as Artist;
    return {
      source: SOURCE,
      source_id: a.source_id,
      name: a.name,
      bio: a.bio,
      nationality: a.nationality,
      birth_year: a.birth_year,
      death_year: a.death_year,
      wikidata_id: a.wikidata_id,
      source_url: `https://www.moma.org/artists/${a.source_id}`,
    };
  });
  const withImage = artworks.filter((a) => a.image_url != null).length;
  console.log(
    `[ingest:moma] mapped ${artworks.length} artworks ` +
      `(${withImage} with an image), ${artistRows.length} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:moma] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(MOMA_INSTITUTION, { onConflict: "source,source_id" })
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
  console.log(`[ingest:moma] upserted ${upsertedArtists.length} artists`);

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
  console.log(`[ingest:moma] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:moma] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:moma] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
