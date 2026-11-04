// Minimal client for the Art Institute of Chicago public API.
// Docs: https://api.artic.edu/docs/
//
// The API needs no key. AIC asks consumers to identify themselves with a
// User-Agent. All requests pass through a single global rate-limit gate so the
// ingestion script can never accidentally flood the API.

const AIC_BASE = "https://api.artic.edu/api/v1";
const USER_AGENT =
  "Dartabase/0.1 (art reference aggregator; +https://github.com/Maltysnack/Dartabase)";

export const DEFAULT_IIIF_URL = "https://www.artic.edu/iiif/2";

export interface AicArtwork {
  id: number;
  title: string | null;
  artist_id: number | null;
  artist_title: string | null;
  date_display: string | null;
  date_start: number | null;
  date_end: number | null;
  medium_display: string | null;
  material_titles: string[] | null;
  dimensions: string | null;
  credit_line: string | null;
  image_id: string | null;
  is_public_domain: boolean | null;
  department_title: string | null;
  classification_title: string | null;
  updated_at: string | null;
}

export interface AicArtist {
  id: number;
  title: string | null;
  sort_title: string | null;
  birth_date: number | null;
  death_date: number | null;
  description: string | null;
}

export interface AicExhibition {
  id: number;
  title: string | null;
  description: string | null;
  web_url: string | null;
  aic_start_at: string | null;
  aic_end_at: string | null;
  status: string | null;
  artwork_ids: number[] | null;
}

interface AicListResponse<T> {
  pagination: {
    total: number;
    limit: number;
    offset: number;
    current_page: number;
    total_pages: number;
  };
  data: T[];
  config: { iiif_url: string };
}

const ARTWORK_FIELDS = [
  "id", "title", "artist_id", "artist_title", "date_display", "date_start",
  "date_end", "medium_display", "material_titles", "dimensions", "credit_line",
  "image_id", "is_public_domain", "department_title", "classification_title",
  "updated_at",
].join(",");

const ARTIST_FIELDS = [
  "id", "title", "sort_title", "birth_date", "death_date", "description",
].join(",");

const EXHIBITION_FIELDS = [
  "id", "title", "description", "web_url", "aic_start_at", "aic_end_at",
  "status", "artwork_ids",
].join(",");

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Global rate-limit gate. Every AIC request waits its turn so total request
// rate stays at one call per `minIntervalMs`, no matter the call site.
let lastCallAt = 0;
let minIntervalMs = 1000;

export function setRateLimit(ms: number): void {
  minIntervalMs = Math.max(0, ms);
}

async function rateLimitGate(): Promise<void> {
  const wait = lastCallAt + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function aicFetch<T>(
  path: string,
  params: Record<string, string | number>,
): Promise<T> {
  await rateLimitGate();
  const url = new URL(`${AIC_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "AIC-User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(
      `AIC API ${res.status} ${res.statusText} for ${url.pathname}${url.search}`,
    );
  }
  return (await res.json()) as T;
}

export async function fetchArtworksPage(
  page: number,
  pageSize: number,
): Promise<AicListResponse<AicArtwork>> {
  return aicFetch<AicListResponse<AicArtwork>>("/artworks", {
    page,
    limit: pageSize,
    fields: ARTWORK_FIELDS,
  });
}

export async function fetchArtistsByIds(ids: number[]): Promise<AicArtist[]> {
  const out: AicArtist[] = [];
  // AIC caps the `ids` parameter, so batch in groups of 100.
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const res = await aicFetch<AicListResponse<AicArtist>>("/artists", {
      ids: batch.join(","),
      limit: 100,
      fields: ARTIST_FIELDS,
    });
    out.push(...res.data);
  }
  return out;
}

export async function fetchExhibitionsPage(
  page: number,
  pageSize: number,
): Promise<AicListResponse<AicExhibition>> {
  return aicFetch<AicListResponse<AicExhibition>>("/exhibitions", {
    page,
    limit: pageSize,
    fields: EXHIBITION_FIELDS,
  });
}

// Fetches artworks by id (batched, since AIC caps the `ids` parameter), and
// returns the IIIF base URL needed to build image URLs.
export async function fetchArtworksByIds(
  ids: number[],
): Promise<{ artworks: AicArtwork[]; iiifUrl: string }> {
  const artworks: AicArtwork[] = [];
  let iiifUrl = DEFAULT_IIIF_URL;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const res = await aicFetch<AicListResponse<AicArtwork>>("/artworks", {
      ids: batch.join(","),
      limit: 100,
      fields: ARTWORK_FIELDS,
    });
    iiifUrl = res.config?.iiif_url ?? iiifUrl;
    artworks.push(...res.data);
  }
  return { artworks, iiifUrl };
}

// Fetches `pages` pages of artworks from the AIC list endpoint. Used by the
// weekly cron to keep metadata fresh for the records we already hold. The AIC
// search endpoint (needed for arbitrary sort) requires API authentication; the
// list endpoint is public but only supports the default sort (by id asc).
// Fetching pages 1-N covers the same records the initial ingest imported, so
// any metadata updates (image IDs, rights, dates) flow into our DB weekly.
export async function fetchArtworkPages(
  pages: number,
  pageSize = 100,
): Promise<{ artworks: AicArtwork[]; iiifUrl: string }> {
  const artworks: AicArtwork[] = [];
  let iiifUrl = DEFAULT_IIIF_URL;
  for (let page = 1; page <= pages; page++) {
    const res = await fetchArtworksPage(page, pageSize);
    iiifUrl = res.config?.iiif_url ?? iiifUrl;
    artworks.push(...res.data);
  }
  return { artworks, iiifUrl };
}
