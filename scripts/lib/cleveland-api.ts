// Minimal client for the Cleveland Museum of Art Open Access API.
// Docs: https://openaccess-api.clevelandart.org/  No key required.
//
// The `cc0=1` and `has_image=1` filters mean every returned artwork is public
// domain and has an image, so no per-object filtering for rights is needed.

const CLEVELAND_BASE = "https://openaccess-api.clevelandart.org/api";
const USER_AGENT =
  "Dartabase/0.1 (art reference aggregator; +https://github.com/Maltysnack/Dartabase)";

export interface ClevelandCreator {
  id: number | null;
  description: string | null;
  role: string | null;
  birth_year: string | null;
  death_year: string | null;
}

export interface ClevelandArtwork {
  id: number;
  title: string | null;
  creation_date: string | null;
  sortable_date: number | null;
  technique: string | null;
  measurements: string | null;
  creditline: string | null;
  url: string | null;
  creators: ClevelandCreator[] | null;
  images: { web?: { url?: string } } | null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastCallAt = 0;
let minIntervalMs = 150;

export function setRateLimit(ms: number): void {
  minIntervalMs = Math.max(0, ms);
}

async function rateLimitGate(): Promise<void> {
  const wait = lastCallAt + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function clevelandFetch<T>(path: string): Promise<T> {
  await rateLimitGate();
  const res = await fetch(`${CLEVELAND_BASE}${path}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(
      `Cleveland API ${res.status} ${res.statusText} for ${path}`,
    );
  }
  return (await res.json()) as T;
}

export async function fetchArtworksPage(
  skip: number,
  limit: number,
): Promise<{ total: number; data: ClevelandArtwork[] }> {
  const res = await clevelandFetch<{
    info: { total: number };
    data: ClevelandArtwork[];
  }>(`/artworks/?cc0=1&has_image=1&skip=${skip}&limit=${limit}`);
  return { total: res.info?.total ?? 0, data: res.data ?? [] };
}
