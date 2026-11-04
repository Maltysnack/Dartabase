// Minimal client for The Metropolitan Museum of Art Collection API.
// Docs: https://metmuseum.github.io/  No key required.
//
// The Met has no bulk endpoint: you fetch a department's list of object IDs,
// then fetch each object individually. All requests pass through one global
// rate-limit gate so the script stays polite.

const MET_BASE = "https://collectionapi.metmuseum.org/public/collection/v1";
const USER_AGENT =
  "Dartabase/0.1 (art reference aggregator; +https://github.com/Maltysnack/Dartabase)";

export interface MetConstituent {
  constituentID: number;
  name: string;
  role: string;
}

export interface MetObject {
  objectID: number;
  title: string | null;
  artistDisplayName: string | null;
  artistNationality: string | null;
  artistBeginDate: string | null;
  artistEndDate: string | null;
  objectDate: string | null;
  objectBeginDate: number | null;
  medium: string | null;
  dimensions: string | null;
  creditLine: string | null;
  classification: string | null;
  isPublicDomain: boolean | null;
  primaryImage: string | null;
  primaryImageSmall: string | null;
  objectURL: string | null;
  objectWikidata_URL: string | null;
  constituents: MetConstituent[] | null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastCallAt = 0;
let minIntervalMs = 80;

export function setRateLimit(ms: number): void {
  minIntervalMs = Math.max(0, ms);
}

async function rateLimitGate(): Promise<void> {
  const wait = lastCallAt + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

const MAX_ATTEMPTS = 4;

// Retries on network errors and on throttle/server statuses (429, 403, 5xx)
// with linear backoff, so a temporary Met rate limit does not silently drop
// records.
async function metFetch<T>(path: string, attempt = 1): Promise<T> {
  await rateLimitGate();

  let res: Response;
  try {
    res = await fetch(`${MET_BASE}${path}`, {
      headers: { "User-Agent": USER_AGENT },
    });
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      await sleep(1000 * attempt);
      return metFetch<T>(path, attempt + 1);
    }
    throw err;
  }

  if (
    (res.status === 429 || res.status === 403 || res.status >= 500) &&
    attempt < MAX_ATTEMPTS
  ) {
    await sleep(1000 * attempt);
    return metFetch<T>(path, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`Met API ${res.status} ${res.statusText} for ${path}`);
  }
  return (await res.json()) as T;
}

export async function fetchDepartmentObjectIDs(
  departmentId: number,
): Promise<number[]> {
  const res = await metFetch<{ total: number; objectIDs: number[] | null }>(
    `/objects?departmentIds=${departmentId}`,
  );
  return res.objectIDs ?? [];
}

export async function fetchObject(id: number): Promise<MetObject> {
  return metFetch<MetObject>(`/objects/${id}`);
}
