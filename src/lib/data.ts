// Browser-side access to the static data in /data (written by scripts/export-static.ts).
// There is no server: every lookup is a fetch of one small JSON file.

import {
  idKey,
  normalise,
  tokenKey,
  tokens,
  type SearchArtist,
  type SearchArtwork,
} from "./shard";

// Set NEXT_PUBLIC_BASE_PATH (e.g. "/Dartabase") when the site is served from a
// sub-path, as GitHub project pages are.
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const REPO = process.env.NEXT_PUBLIC_REPO ?? "Maltysnack/Dartabase";

export interface Work {
  id: string;
  title: string;
  artist: {
    id: string;
    name: string;
    sort: string | null;
    birth: number | null;
    death: number | null;
  } | null;
  date: string | null;
  year: number | null;
  medium: string | null;
  dimensions: string | null;
  institution: { name: string; city: string | null; website: string | null } | null;
  credit: string | null;
  image: string | null;
  licence: string | null;
  source: string;
  sourceId: string | null;
  sourceUrl: string | null;
  icip?: boolean;
  attribution?: string;
  classification: string | null;
}

// [id, title, date text, year, institution name, has image]
export type WorkRow = [string, string, string | null, number | null, string | null, 0 | 1];

export interface ArtistRecord {
  id: string;
  name: string;
  aka: string[];
  birth: number | null;
  death: number | null;
  nationality: string | null;
  image: string | null;
  wikidata: string | null;
  works: WorkRow[];
}

export interface GalleryRow {
  name: string;
  city: string | null;
  country: string | null;
  website: string | null;
  works: number;
  images: number;
}

export interface Stats {
  artworks: number;
  artists: number;
  institutions: number;
  built: string;
}

const cache = new Map<string, Promise<unknown>>();

function getJson<T>(path: string): Promise<T | null> {
  let hit = cache.get(path) as Promise<T | null> | undefined;
  if (!hit) {
    hit = fetch(`${BASE}/data/${path}`)
      .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
      .catch(() => null);
    cache.set(path, hit);
  }
  return hit;
}

export async function getWork(id: string): Promise<Work | null> {
  const shard = await getJson<Record<string, Work>>(`w/${idKey(id)}.json`);
  return shard?.[id] ?? null;
}

export async function getArtist(id: string): Promise<ArtistRecord | null> {
  const shard = await getJson<Record<string, ArtistRecord>>(`ar/${idKey(id)}.json`);
  return shard?.[id] ?? null;
}

export const getFeatured = () => getJson<Work[]>("featured.json");
export const getGalleries = () => getJson<GalleryRow[]>("institutions.json");
export const getStats = () => getJson<Stats>("stats.json");

export interface SearchResults {
  artists: SearchArtist[];
  works: SearchArtwork[];
  tooShort: boolean;
}

const MAX_WORKS = 60;
const MAX_ARTISTS = 12;

// Every query token must be the start of some word in the entry.
function matchesAll(words: string[], query: string[]): boolean {
  return query.every((q) => words.some((w) => w.startsWith(q)));
}

export async function search(query: string): Promise<SearchResults> {
  const q = tokens(query);
  if (q.length === 0) {
    return { artists: [], works: [], tooShort: normalise(query).trim().length > 0 };
  }
  // Look up the longest token (usually the rarest); the rest filter.
  const lead = [...q].sort((a, b) => b.length - a.length)[0];
  const key = tokenKey(lead);
  const [sa, sw] = await Promise.all([
    getJson<Record<string, SearchArtist[]>>(`sa/${key}.json`),
    getJson<Record<string, SearchArtwork[]>>(`sw/${key}.json`),
  ]);

  const artists = new Map<string, SearchArtist>();
  for (const [token, list] of Object.entries(sa ?? {})) {
    if (!token.startsWith(lead)) continue;
    for (const e of list) {
      if (matchesAll(tokens(e[1]), q)) artists.set(e[0], e);
    }
  }
  const works = new Map<string, SearchArtwork>();
  for (const [token, list] of Object.entries(sw ?? {})) {
    if (!token.startsWith(lead)) continue;
    for (const e of list) {
      if (works.has(e[0])) continue;
      if (matchesAll(tokens(`${e[1]} ${e[2] ?? ""}`), q)) works.set(e[0], e);
    }
  }
  return {
    artists: [...artists.values()].sort((a, b) => b[5] - a[5]).slice(0, MAX_ARTISTS),
    works: [...works.values()].sort((a, b) => b[4] - a[4]).slice(0, MAX_WORKS),
    tooShort: false,
  };
}

export const artworkHref = (id: string) => `/artwork/?id=${id}`;
export const artistHref = (id: string) => `/artist/?id=${id}`;

export function lifeSpan(birth: number | null, death: number | null): string {
  if (birth != null && death != null) return `${birth}–${death}`;
  if (birth != null) return `b. ${birth}`;
  if (death != null) return `d. ${death}`;
  return "";
}
