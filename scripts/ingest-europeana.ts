// Ingestion adapter for the Europeana API.
//
// Europeana aggregates digitized cultural heritage from 3,000+ European
// institutions. This script fetches paintings with identified creators,
// open reuse rights, and available images.
//
// Auth: set EUROPEANA_API_KEY in .env.local. Falls back to the public
// demo key (api2demo) which is rate-limited to 10,000 req/day.
//
// Institutions are recorded per dataProvider, so one run creates many
// institution rows (one per contributing museum/gallery).
//
// Upserts key on (source, source_id) with source = 'europeana'. Re-running
// is safe.
//
// Examples:
//   pnpm ingest:europeana -- --dry-run --limit 50
//   pnpm ingest:europeana -- --limit 5000

import { createAdminClient } from "./lib/supabase-admin";
import { yearFromText } from "./lib/year";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "europeana";
const API_BASE = "https://api.europeana.eu/record/v2/search.json";
const PAGE_SIZE = 100;
const UPSERT_CHUNK = 500;

// Europeana item URL base (stable public URL for each record).
const EUROPEANA_ITEM_BASE = "https://www.europeana.eu/item";

// Query parameters: paintings with an identified creator, open license, image.
const QUERY_PARAMS =
  "query=who%3A*&qf=TYPE%3AIMAGE&qf=what%3Apainting&reusability=open&media=true";

interface Args {
  limit: number;
  delayMs: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let delayMs = 300;
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
        "Example: pnpm ingest:europeana -- --dry-run --limit 50",
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

// Extract a human-readable artist name from the dcCreator array.
// Europeana often mixes URI strings with plain-text names in the same array.
// Take the first entry that is not a URI.
function extractCreatorName(dcCreator: string[] | null | undefined): string | null {
  if (!dcCreator || dcCreator.length === 0) return null;
  for (const entry of dcCreator) {
    const s = entry.trim();
    if (s && !s.startsWith("http") && !s.startsWith("urn:")) {
      return s;
    }
  }
  return null;
}

// Take the first title string. Europeana sometimes returns multiple language
// versions in the array; use the first one as-is (often the source language
// or English).
function extractTitle(titles: string[] | null | undefined): string | null {
  if (!titles || titles.length === 0) return null;
  const t = titles[0].trim();
  return t || null;
}

// Convert the Europeana record ID ("/3/item_abc") to a stable public URL.
function idToSourceUrl(id: string): string {
  // id is of the form "/collectionId/recordId"
  const path = id.startsWith("/") ? id : `/${id}`;
  return `${EUROPEANA_ITEM_BASE}${path}`;
}

// Slugify a provider name for use as a source_id.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface EuropeanaItem {
  id: string;
  title?: string[];
  dcCreator?: string[];
  year?: string[];
  dataProvider?: string[];
  country?: string[];
  edmPreview?: string[];
  rights?: string[];
  guid?: string;
}

interface EuropeanaSearchResponse {
  success: boolean;
  totalResults?: number;
  itemsCount?: number;
  nextCursor?: string;
  items?: EuropeanaItem[];
  error?: string;
}

interface MappedArtist {
  source_id: string;
  name: string;
  birth_year: null;
  death_year: null;
  nationality: string | null;
}

interface MappedInstitution {
  source: string;
  source_id: string;
  name: string;
  type: string;
  city: null;
  country: string | null;
  website: null;
  source_url: string;
}

interface MappedArtwork {
  source: string;
  source_id: string;
  title: string;
  date_text: string | null;
  date_year: number | null;
  medium: null;
  dimensions: null;
  credit_line: null;
  image_url: string | null;
  image_license: string | null;
  source_url: string;
  artist_source_id: string;
  institution_source_id: string;
}

function mapItem(
  item: EuropeanaItem,
): { artwork: MappedArtwork; artist: MappedArtist; institution: MappedInstitution } | null {
  const title = extractTitle(item.title);
  if (!title) return null;

  const creatorName = extractCreatorName(item.dcCreator);
  if (!creatorName) return null;

  const thumbnail = item.edmPreview?.[0] ?? null;
  if (!thumbnail) return null;

  const providerName = item.dataProvider?.[0] ?? "Europeana";
  const country = clean(item.country?.[0]) ?? null;

  const yearText = clean(item.year?.[0]);
  const dateYear = yearFromText(yearText);

  const sourceUrl = idToSourceUrl(item.id);

  const rightsUri = item.rights?.[0] ?? null;
  // Compose a brief license label from the rights URI.
  let imageLicense: string | null = null;
  if (rightsUri) {
    if (rightsUri.includes("publicdomain/mark") || rightsUri.includes("publicdomain/zero")) {
      imageLicense = "Public Domain";
    } else if (rightsUri.includes("creativecommons.org/licenses/by-sa")) {
      imageLicense = "CC BY-SA";
    } else if (rightsUri.includes("creativecommons.org/licenses/by/")) {
      imageLicense = "CC BY";
    } else if (rightsUri.includes("creativecommons.org/publicdomain")) {
      imageLicense = "CC0";
    } else {
      imageLicense = "Open";
    }
  }

  const artistSlug = creatorName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const artistSourceId = `artist:${artistSlug}`;

  const institutionSlug = slugify(providerName);
  const institutionSourceId = `institution:${institutionSlug}`;

  return {
    artwork: {
      source: SOURCE,
      source_id: item.id,
      title,
      date_text: yearText,
      date_year: dateYear,
      medium: null,
      dimensions: null,
      credit_line: null,
      image_url: thumbnail,
      image_license: imageLicense,
      source_url: sourceUrl,
      artist_source_id: artistSourceId,
      institution_source_id: institutionSourceId,
    },
    artist: {
      source_id: artistSourceId,
      name: creatorName,
      birth_year: null,
      death_year: null,
      nationality: country,
    },
    institution: {
      source: SOURCE,
      source_id: institutionSourceId,
      name: providerName,
      type: "museum",
      city: null,
      country,
      website: null,
      source_url: "https://www.europeana.eu",
    },
  };
}

async function fetchPage(
  apiKey: string,
  cursor: string,
): Promise<EuropeanaSearchResponse> {
  const url =
    `${API_BASE}?${QUERY_PARAMS}&rows=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}&wskey=${apiKey}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(
      `Europeana API ${res.status} ${res.statusText}`,
    );
  }
  return res.json() as Promise<EuropeanaSearchResponse>;
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
  const apiKey = process.env.EUROPEANA_API_KEY ?? "api2demo";
  console.log(
    `[ingest:europeana] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}, key=${apiKey === "api2demo" ? "demo" : "custom"}`,
  );

  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, MappedArtist>();
  const institutions = new Map<string, MappedInstitution>();

  let cursor = "*";
  let page = 0;
  let totalSeen = 0;

  while (artworks.length < args.limit) {
    const data = await fetchPage(apiKey, cursor);

    if (!data.success) {
      throw new Error(`Europeana API error: ${data.error ?? "unknown"}`);
    }

    const items = data.items ?? [];
    if (items.length === 0) break;

    page++;
    totalSeen += items.length;

    for (const item of items) {
      if (artworks.length >= args.limit) break;
      const mapped = mapItem(item);
      if (!mapped) continue;
      artworks.push(mapped.artwork);
      if (!artists.has(mapped.artist.source_id)) {
        artists.set(mapped.artist.source_id, mapped.artist);
      }
      if (!institutions.has(mapped.institution.source_id)) {
        institutions.set(mapped.institution.source_id, mapped.institution);
      }
    }

    console.log(
      `[ingest:europeana] page ${page}: ${items.length} fetched, ` +
        `${artworks.length} artworks collected (${totalSeen} scanned)`,
    );

    if (!data.nextCursor) break;
    cursor = data.nextCursor;
    await sleep(args.delayMs);
  }

  const withImage = artworks.filter((a) => a.image_url != null).length;
  console.log(
    `[ingest:europeana] mapped ${artworks.length} artworks ` +
      `(${withImage} with image), ${artists.size} artists, ` +
      `${institutions.size} institutions from ${totalSeen} records scanned`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:europeana] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    console.log("\nSample artists:");
    for (const a of [...artists.values()].slice(0, 3)) {
      console.log(JSON.stringify(a, null, 2));
    }
    console.log("\nSample institutions:");
    for (const inst of [...institutions.values()].slice(0, 3)) {
      console.log(JSON.stringify(inst, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  // Upsert all institutions, collect their DB IDs.
  const institutionRows = [...institutions.values()];
  const upsertedInstitutions = await chunkedUpsert(
    supabase,
    "institutions",
    institutionRows as unknown as Record<string, unknown>[],
    "id,source_id",
  );
  const institutionIdBySourceId = new Map<string, string>(
    upsertedInstitutions.map((row) => [
      row.source_id as string,
      row.id as string,
    ]),
  );
  console.log(`[ingest:europeana] upserted ${upsertedInstitutions.length} institutions`);

  // Upsert artists.
  const artistRows = [...artists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    name: a.name,
    birth_year: a.birth_year,
    death_year: a.death_year,
    nationality: a.nationality,
    source_url: "https://www.europeana.eu",
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
  console.log(`[ingest:europeana] upserted ${upsertedArtists.length} artists`);

  // Upsert artworks.
  const artworkRows = artworks.map(
    ({ artist_source_id, institution_source_id, ...rest }) => ({
      ...rest,
      artist_id: artistIdBySourceId.get(artist_source_id) ?? null,
      current_institution_id:
        institutionIdBySourceId.get(institution_source_id) ?? null,
    }),
  );
  const upsertedArtworks = await chunkedUpsert(
    supabase,
    "artworks",
    artworkRows as unknown as Record<string, unknown>[],
    "id",
  );
  console.log(`[ingest:europeana] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:europeana] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:europeana] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
