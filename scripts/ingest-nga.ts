// Ingestion adapter for the National Gallery of Art, Washington.
//
// Reads the NGA Open Data Program CSVs (CC0) and upserts artworks and artists
// into Supabase. The dataset is a set of relational CSVs:
//   objects.csv               artwork records
//   objects_constituents.csv  links objects to their makers, with a role
//   constituents.csv          maker records (artists, but also donors, owners)
//   published_images.csv      open-access IIIF images, linked by object id
//
// objects.csv and published_images.csv are large (80MB+), so every file is
// streamed, never loaded whole. The three lookup files are streamed into small
// in-memory maps first; objects.csv is then streamed and joined against them.
//
// Upserts key on (source, source_id) with source = 'nga', so re-running is
// idempotent. NGA records carry Wikidata IDs, which we keep; run `pnpm dedup`
// afterwards to fold NGA artists into shared canonical records.
//
// Known v1 limitations: attribution qualifiers (a "workshop of" or "after"
// prefix in objects_constituents) are not modelled, so such a work links to
// the named artist directly; works with several makers use the primary only.
//
// Examples:
//   pnpm ingest:nga -- --dry-run --limit 10
//   pnpm ingest:nga -- --limit 800

import { createAdminClient } from "./lib/supabase-admin";
import { streamCsv } from "./lib/csv-stream";
import { yearFromText } from "./lib/year";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "nga";
const UPSERT_CHUNK = 500;
const REPO_RAW =
  "https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data";

// Classifications we treat as artworks. The dataset also holds archival and
// reference material (volumes, technical material, indexes) that we skip.
const ARTWORK_CLASSES = new Set([
  "painting",
  "sculpture",
  "drawing",
  "print",
  "photograph",
  "decorative art",
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
        "Example: pnpm ingest:nga -- --dry-run --limit 10",
    );
  }
  return { limit, dryRun };
}

// A plain integer year column. NGA uses 0 / blank for "unknown".
function yearFromInt(value: string | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n !== 0 ? n : null;
}

// A year out of free text like "c. 1310" or "1928/1929".
// Trim, and flatten the multi-line values NGA stores (notably dimensions, which
// lists several measurements one per line) into a single readable line.
function clean(value: string | undefined): string | null {
  const normalized = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (normalized === "") return null;
  return normalized.replace(/\s*\n\s*/g, "; ").replace(/[ \t]{2,}/g, " ");
}

interface Constituent {
  source_id: string;
  name: string;
  sort_name: string | null;
  birth_year: number | null;
  death_year: number | null;
  nationality: string | null;
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
  wikidata_id: string | null;
  source_url: string;
  artist_source_id: string;
}

const NGA_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:nga",
  name: "National Gallery of Art",
  type: "museum",
  city: "Washington",
  country: "United States",
  website: "https://www.nga.gov",
  source_url: "https://www.nga.gov",
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
    `[ingest:nga] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  // 1. Maker records, keyed by constituent id.
  console.log("[ingest:nga] streaming constituents.csv...");
  const constituents = new Map<string, Constituent>();
  await streamCsv(`${REPO_RAW}/constituents.csv`, (row) => {
    const id = (row.constituentid ?? "").trim();
    const name = (row.forwarddisplayname ?? "").trim();
    if (id === "" || name === "") return;
    constituents.set(id, {
      source_id: id,
      name,
      sort_name: clean(row.preferreddisplayname),
      birth_year: yearFromInt(row.beginyear),
      death_year: yearFromInt(row.endyear),
      nationality: clean(row.nationality),
      wikidata_id: clean(row.wikidataid),
    });
  });
  console.log(`[ingest:nga] ${constituents.size} constituents`);

  // 2. Primary artist per object: the artist-role constituent with the
  //    lowest display order.
  console.log("[ingest:nga] streaming objects_constituents.csv...");
  const artistByObject = new Map<string, { cid: string; order: number }>();
  await streamCsv(`${REPO_RAW}/objects_constituents.csv`, (row) => {
    if (row.roletype !== "artist") return;
    const objectId = (row.objectid ?? "").trim();
    const cid = (row.constituentid ?? "").trim();
    if (objectId === "" || cid === "") return;
    const order = Number(row.displayorder);
    const rank = Number.isFinite(order) ? order : 999;
    const existing = artistByObject.get(objectId);
    if (!existing || rank < existing.order) {
      artistByObject.set(objectId, { cid, order: rank });
    }
  });
  console.log(`[ingest:nga] ${artistByObject.size} objects with an artist`);

  // 3. Open-access primary image per object.
  console.log("[ingest:nga] streaming published_images.csv...");
  const imageByObject = new Map<string, string>();
  await streamCsv(`${REPO_RAW}/published_images.csv`, (row) => {
    if (row.openaccess !== "1" || row.viewtype !== "primary") return;
    const objectId = (row.depictstmsobjectid ?? "").trim();
    const iiif = (row.iiifurl ?? "").trim();
    if (objectId === "" || iiif === "" || imageByObject.has(objectId)) return;
    imageByObject.set(objectId, iiif);
  });
  console.log(`[ingest:nga] ${imageByObject.size} open-access primary images`);

  // 4. Objects. Stream and collect up to the limit.
  console.log("[ingest:nga] streaming objects.csv...");
  const artworks: MappedArtwork[] = [];
  const usedConstituents = new Set<string>();
  await streamCsv(`${REPO_RAW}/objects.csv`, (row) => {
    if (artworks.length >= args.limit) return;
    if (row.isvirtual === "1") return;
    if (!ARTWORK_CLASSES.has((row.classification ?? "").toLowerCase())) return;
    const title = (row.title ?? "").trim();
    const objectId = (row.objectid ?? "").trim();
    if (title === "" || objectId === "") return;

    const link = artistByObject.get(objectId);
    if (!link) return;
    const artist = constituents.get(link.cid);
    if (!artist) return;
    usedConstituents.add(link.cid);

    // Image-first policy: NGA publishes IIIF images for open-access works in
    // published_images.csv; skip records not present in that index.
    const iiif = imageByObject.get(objectId);
    if (!iiif) return;

    artworks.push({
      source: SOURCE,
      source_id: objectId,
      title,
      date_text: clean(row.displaydate),
      date_year: yearFromInt(row.beginyear) ?? yearFromText(row.displaydate),
      medium: clean(row.medium),
      dimensions: clean(row.dimensions),
      credit_line: clean(row.creditline),
      image_url: `${iiif}/full/!800,800/0/default.jpg`,
      image_license: "NGA Open Access (public domain)",
      wikidata_id: clean(row.wikidataid),
      source_url: `https://www.nga.gov/artworks/${objectId}`,
      artist_source_id: link.cid,
    });
  });

  const artistRows = [...usedConstituents].map((cid) => {
    const c = constituents.get(cid) as Constituent;
    return {
      source: SOURCE,
      source_id: c.source_id,
      name: c.name,
      sort_name: c.sort_name,
      birth_year: c.birth_year,
      death_year: c.death_year,
      nationality: c.nationality,
      wikidata_id: c.wikidata_id,
      source_url: "https://www.nga.gov/artists",
    };
  });
  const withImage = artworks.filter((a) => a.image_url != null).length;
  console.log(
    `[ingest:nga] mapped ${artworks.length} artworks ` +
      `(${withImage} with an image), ${artistRows.length} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:nga] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(NGA_INSTITUTION, { onConflict: "source,source_id" })
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
  console.log(`[ingest:nga] upserted ${upsertedArtists.length} artists`);

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
  console.log(`[ingest:nga] upserted ${upsertedArtworks.length} artworks`);
  console.log("[ingest:nga] done. Run `pnpm dedup` to fold cross-source duplicates.");
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:nga] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
