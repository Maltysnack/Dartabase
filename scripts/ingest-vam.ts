// Ingestion adapter for the Victoria and Albert Museum (V&A), London.
//
// Uses the public V&A REST API (no auth required). Fetches paintings,
// watercolours, and drawings with identified makers. Images are served via
// the V&A's IIIF endpoint (framemark.vam.ac.uk) and proxied through
// /api/img on the Dartabase side.
//
// Artist names from the API are in "Lastname, Firstname" format and are
// reversed to "Firstname Lastname" before upsert.
//
// Upserts key on (source, source_id) with source = 'vam'. Re-running is safe.
//
// Examples:
//   pnpm ingest:vam -- --dry-run --limit 50
//   pnpm ingest:vam -- --limit 2000

import { createAdminClient } from "./lib/supabase-admin";
import { yearFromText } from "./lib/year";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "vam";
const API_BASE = "https://api.vam.ac.uk/v2/objects/search";
const PAGE_SIZE = 100;
const UPSERT_CHUNK = 500;

// Object types the V&A uses for standalone artworks (not decorative panels
// or applied arts objects). Include Watercolour alongside Painting as it is
// consistently used for independent works in the V&A catalogue.
const ACCEPTED_TYPES = new Set([
  "Painting",
  "Watercolour",
  "Drawing",
  "Photograph",
  "Watercolor",
]);

// Artist name patterns that indicate anonymous or unidentified makers.
const ANONYMOUS_RE =
  /^(unknown|anonymous|unidentified|various|after |school of|circle of|follower of|workshop of|attributed to|manner of)/i;

interface Args {
  limit: number;
  delayMs: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let delayMs = 200;
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
        "Example: pnpm ingest:vam -- --dry-run --limit 50",
    );
  }
  return { limit, delayMs, dryRun };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function clean(value: string | undefined | null): string | null {
  const s = (value ?? "").replace(/\r\n?/g, "\n").trim();
  return s || null;
}

// Reverse V&A's "Lastname, Firstname" format to "Firstname Lastname".
// Handles "Unknown" (no comma), multi-part names, and titles embedded
// in the name (e.g. "Smith, John (Sir)").
function reverseArtistName(raw: string): string {
  const name = raw.trim();
  const comma = name.indexOf(",");
  if (comma === -1) return name;
  const last = name.slice(0, comma).trim();
  const rest = name.slice(comma + 1).trim();
  // rest might be "John (Sir)" or "John William"
  return rest ? `${rest} ${last}` : last;
}

function buildImageUrl(imageId: string | undefined | null): string | null {
  if (!imageId) return null;
  return `https://framemark.vam.ac.uk/collections/${imageId}/full/!400,400/0/default.jpg`;
}

interface VamMaker {
  name: string;
  association: string;
}

interface VamImages {
  _primary_thumbnail?: string;
  _iiif_image_base_url?: string;
  imageResolution?: string;
}

interface VamRecord {
  systemNumber: string;
  objectType?: string;
  _primaryTitle?: string;
  _primaryMaker?: VamMaker | null;
  _primaryImageId?: string | null;
  _primaryDate?: string | null;
  _images?: VamImages;
  _warningTypes?: string[];
}

interface VamSearchResponse {
  info: {
    record_count: number;
    pages: number;
    page: number;
    page_size: number;
  };
  records: VamRecord[];
}

interface Artist {
  source_id: string;
  name: string;
  birth_year: null;
  death_year: null;
  nationality: null;
}

interface MappedArtwork {
  source: string;
  source_id: string;
  title: string;
  date_text: string | null;
  date_year: number | null;
  medium: string | null;
  dimensions: null;
  credit_line: null;
  image_url: string | null;
  image_license: string | null;
  source_url: string | null;
  artist_source_id: string;
}

const VAM_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:vam",
  name: "Victoria and Albert Museum",
  type: "museum",
  city: "London",
  country: "United Kingdom",
  website: "https://www.vam.ac.uk",
  source_url: "https://www.vam.ac.uk",
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

function mapRecord(
  rec: VamRecord,
): { artwork: MappedArtwork; artist: Artist } | null {
  // Must be a recognised standalone artwork type.
  if (!rec.objectType || !ACCEPTED_TYPES.has(rec.objectType)) return null;

  // Must have a title.
  const title = clean(rec._primaryTitle);
  if (!title) return null;

  // Must have an identified maker.
  const makerRaw = rec._primaryMaker?.name ?? "";
  if (!makerRaw || ANONYMOUS_RE.test(makerRaw)) return null;
  const artistName = reverseArtistName(makerRaw);
  if (!artistName) return null;

  // Must have an image (we only ingest what the V&A has itself published).
  const imageId = rec._primaryImageId;
  if (!imageId) return null;

  const dateText = clean(rec._primaryDate);
  const dateYear = yearFromText(dateText);

  const isHighRes = rec._images?.imageResolution === "high";
  const imageUrl = buildImageUrl(imageId);
  const imageLicense = isHighRes
    ? "Victoria and Albert Museum (CC0)"
    : null;

  // Stable V&A collection URL for this object.
  const sourceUrl = `https://collections.vam.ac.uk/item/${rec.systemNumber}/`;

  // Use a slug-safe artist source_id derived from the name to deduplicate
  // across pages (the summary API does not expose V&A artist IDs).
  const artistSourceId = `artist:${artistName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return {
    artwork: {
      source: SOURCE,
      source_id: rec.systemNumber,
      title,
      date_text: dateText,
      date_year: dateYear,
      medium: null,
      dimensions: null,
      credit_line: null,
      image_url: imageUrl,
      image_license: imageLicense,
      source_url: sourceUrl,
      artist_source_id: artistSourceId,
    },
    artist: {
      source_id: artistSourceId,
      name: artistName,
      birth_year: null,
      death_year: null,
      nationality: null,
    },
  };
}

async function fetchPage(page: number): Promise<VamSearchResponse> {
  const url =
    `${API_BASE}?q=&page=${page}&page_size=${PAGE_SIZE}` +
    `&fields=objectnumber,titles,objectType,images,artistMakerPerson,productionDates`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`V&A API ${res.status} ${res.statusText} (page ${page})`);
  }
  return res.json() as Promise<VamSearchResponse>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[ingest:vam] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, Artist>();

  let page = 1;
  let totalSeen = 0;

  while (artworks.length < args.limit) {
    const data = await fetchPage(page);
    const { records } = data;
    if (!records || records.length === 0) break;

    totalSeen += records.length;

    for (const rec of records) {
      if (artworks.length >= args.limit) break;
      const mapped = mapRecord(rec);
      if (!mapped) continue;
      artworks.push(mapped.artwork);
      if (!artists.has(mapped.artist.source_id)) {
        artists.set(mapped.artist.source_id, mapped.artist);
      }
    }

    const maxPage = data.info.pages;
    console.log(
      `[ingest:vam] page ${page}/${maxPage}: ${records.length} records, ` +
        `${artworks.length} artworks collected so far`,
    );

    if (page >= maxPage) break;
    page++;
    await sleep(args.delayMs);
  }

  const artistRows = [...artists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    name: a.name,
    birth_year: a.birth_year,
    death_year: a.death_year,
    nationality: a.nationality,
    source_url: "https://collections.vam.ac.uk",
  }));
  const withImage = artworks.filter((a) => a.image_url != null).length;
  console.log(
    `[ingest:vam] mapped ${artworks.length} artworks ` +
      `(${withImage} with image), ${artistRows.length} artists ` +
      `from ${totalSeen} total records scanned`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:vam] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    console.log("\nSample artists:");
    for (const a of [...artists.values()].slice(0, 3)) {
      console.log(JSON.stringify(a, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(VAM_INSTITUTION, { onConflict: "source,source_id" })
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
  console.log(`[ingest:vam] upserted ${upsertedArtists.length} artists`);

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
  console.log(`[ingest:vam] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:vam] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:vam] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
