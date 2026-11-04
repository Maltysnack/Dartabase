// Ingestion adapter for the Smithsonian Open Access program.
//
// Fetches CC0 image-bearing works from the Smithsonian /search endpoint across
// its art units. Requires a free api.data.gov key, stored in .env.local as
// SMITHSONIAN_API_KEY. Upserts key on (source, source_id) with
// source = 'smithsonian', so re-running is idempotent.
//
// The Smithsonian groups its collection by unit_code. Each art unit gets its
// own institution row in Dartabase so users can drill into SAAM, the Portrait
// Gallery, the Hirshhorn, etc. specifically. FSG / Freer / Sackler is omitted
// because that content now lives under unit_code NMAA.
//
// Examples:
//   pnpm ingest:smithsonian -- --dry-run --limit 21
//   pnpm ingest:smithsonian -- --limit 800

import { createAdminClient } from "./lib/supabase-admin";
import {
  artistSourceIdFromName,
  parseArtistField,
} from "./lib/smithsonian-parsers";
import { yearFromText } from "./lib/year";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "smithsonian";
const UPSERT_CHUNK = 500;
const API = "https://api.si.edu/openaccess/api/v1.0/search";
const PAGE_SIZE = 100;

interface UnitDef {
  code: string;
  name: string;
  city: string;
  country: string;
  website: string;
}

const UNITS: UnitDef[] = [
  {
    code: "SAAM",
    name: "Smithsonian American Art Museum",
    city: "Washington, D.C.",
    country: "United States",
    website: "https://americanart.si.edu",
  },
  {
    code: "NPG",
    name: "National Portrait Gallery",
    city: "Washington, D.C.",
    country: "United States",
    website: "https://npg.si.edu",
  },
  {
    code: "HMSG",
    name: "Hirshhorn Museum and Sculpture Garden",
    city: "Washington, D.C.",
    country: "United States",
    website: "https://hirshhorn.si.edu",
  },
  {
    code: "NMAA",
    name: "National Museum of Asian Art",
    city: "Washington, D.C.",
    country: "United States",
    website: "https://asia.si.edu",
  },
  {
    code: "NMAAHC",
    name: "National Museum of African American History and Culture",
    city: "Washington, D.C.",
    country: "United States",
    website: "https://nmaahc.si.edu",
  },
  {
    code: "NMAfA",
    name: "National Museum of African Art",
    city: "Washington, D.C.",
    country: "United States",
    website: "https://africa.si.edu",
  },
  {
    code: "CHNDM",
    name: "Cooper Hewitt, Smithsonian Design Museum",
    city: "New York, N.Y.",
    country: "United States",
    website: "https://cooperhewitt.org",
  },
];

// Labels on freetext.name that identify a primary maker. Smithsonian's
// cataloguing convention varies by unit; this set covers what shows up in
// practice across all seven art units.
const ARTIST_LABELS = new Set([
  "artist",
  "creator",
  "maker",
  "created by",
  "designer",
  "painter",
  "sculptor",
  "photographer",
  "manufacturer",
  "architect",
  "author",
]);

// Anonymous markers. Records whose mapped artist name resolves to one of these
// are skipped, since they would create useless canonical "Unknown" rows in
// our artists table (the SMK Ubekendt lesson).
const ANONYMOUS_NAMES = new Set([
  "",
  "unknown",
  "unidentified",
  "anonymous",
  "anonyme",
  "various artists",
  "various",
]);

interface Args {
  limit: number;
  delayMs: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let delayMs = 120;
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
        "Example: pnpm ingest:smithsonian -- --dry-run --limit 21",
    );
  }
  return { limit, delayMs, dryRun };
}

function loadApiKey(): string {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local, fall back to the existing environment
  }
  const key = process.env.SMITHSONIAN_API_KEY;
  if (!key) {
    throw new Error(
      "Missing SMITHSONIAN_API_KEY.\n" +
        "Get a free key at https://api.data.gov/signup/\n" +
        "and add it to .env.local:\n  SMITHSONIAN_API_KEY=your-key",
    );
  }
  return key;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function clean(value: string | undefined | null): string | null {
  const normalized = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (normalized === "") return null;
  return normalized.replace(/\s*\n\s*/g, "; ").replace(/[ \t]{2,}/g, " ");
}

// EDAN freetext fields arrive as arrays of { label, content }. Find the first
// item whose label matches the allowed set (case-insensitive), or null.
interface FreetextItem {
  label?: string;
  content?: string;
}
function pickFreetext(
  items: FreetextItem[] | undefined,
  labels: Set<string>,
): string | null {
  for (const it of items ?? []) {
    const label = (it.label ?? "").toLowerCase();
    if (labels.has(label)) {
      const c = clean(it.content);
      if (c) return c;
    }
  }
  return null;
}

function joinFreetext(items: FreetextItem[] | undefined): string | null {
  const parts = (items ?? [])
    .map((it) => clean(it.content))
    .filter((s): s is string => s != null);
  return parts.length === 0 ? null : parts.join("; ");
}

interface EdanMedia {
  content?: string;
  thumbnail?: string;
  idsId?: string;
  type?: string;
  usage?: { access?: string };
}

interface EdanRecord {
  id: string;
  title?: string;
  unitCode?: string;
  content?: {
    descriptiveNonRepeating?: {
      title?: { content?: string };
      record_link?: string;
      record_ID?: string;
      unit_code?: string;
      online_media?: {
        media?: EdanMedia[];
        mediaCount?: number;
      };
    };
    indexedStructured?: {
      name?: string[];
      date?: string[];
    };
    freetext?: {
      name?: FreetextItem[];
      date?: FreetextItem[];
      identifier?: FreetextItem[];
      objectRights?: FreetextItem[];
      objectType?: FreetextItem[];
      physicalDescription?: FreetextItem[];
      creditLine?: FreetextItem[];
    };
  };
}

interface SearchResponse {
  status: number;
  responseCode: number;
  response: {
    rowCount: number;
    rows?: EdanRecord[];
    message?: string;
  };
}

interface Artist {
  source_id: string;
  name: string;
  birth_year: number | null;
  death_year: number | null;
  nationality: string | null;
}

interface MappedArtwork {
  source: string;
  source_id: string;
  unit_code: string;
  title: string;
  date_text: string | null;
  date_year: number | null;
  medium: string | null;
  dimensions: string | null;
  credit_line: string | null;
  image_url: string | null;
  iiif_manifest_url: string | null;
  image_license: string | null;
  source_url: string | null;
  artist_source_id: string;
}

// artistSourceIdFromName and parseArtistField now live in
// scripts/lib/smithsonian-parsers.ts so they can be unit-tested without
// importing this adapter file (which runs main() at the bottom). See
// scripts/lib/smithsonian-parsers.test.ts for 12-case coverage.

function primaryImageUrl(record: EdanRecord): string | null {
  const media = record.content?.descriptiveNonRepeating?.online_media?.media;
  if (!Array.isArray(media) || media.length === 0) return null;
  const first = media[0];
  const url = first.content ?? first.thumbnail;
  if (!url) return null;
  return url;
}

function mapRecord(
  record: EdanRecord,
  unitCode: string,
):
  | {
      artwork: MappedArtwork;
      artist: Artist;
    }
  | null {
  const dnr = record.content?.descriptiveNonRepeating ?? {};
  const ist = record.content?.indexedStructured ?? {};
  const ft = record.content?.freetext ?? {};

  const title =
    clean(record.title) ?? clean(dnr.title?.content);
  if (!title) return null;

  const imageUrl = primaryImageUrl(record);
  if (!imageUrl) return null;

  // Artist: prefer a role-labeled freetext entry; fall back to the first
  // freetext name; finally fall back to the first indexedStructured name.
  let rawArtist =
    pickFreetext(ft.name, ARTIST_LABELS) ??
    clean(ft.name?.[0]?.content) ??
    null;
  if (!rawArtist && Array.isArray(ist.name) && ist.name.length > 0) {
    rawArtist = clean(ist.name[0]);
  }
  if (!rawArtist) return null;

  const parsed = parseArtistField(rawArtist);
  if (ANONYMOUS_NAMES.has(parsed.name.toLowerCase())) return null;

  const artistId = artistSourceIdFromName(parsed.name);
  if (artistId === "") return null;

  const dateText = pickFreetext(ft.date, new Set(["date"])) ?? ist.date?.[0] ?? null;
  const dateYear = yearFromText(dateText);

  const rights = pickFreetext(ft.objectRights, new Set(["usage", "rights"]))
    ?? ft.objectRights?.[0]?.content
    ?? null;

  const artwork: MappedArtwork = {
    source: SOURCE,
    source_id: record.id,
    unit_code: unitCode,
    title,
    date_text: clean(dateText),
    date_year: dateYear,
    medium: joinFreetext(ft.physicalDescription) ?? joinFreetext(ft.objectType),
    dimensions: null, // Smithsonian buries this in physicalDescription; left null for now
    credit_line: clean(ft.creditLine?.[0]?.content),
    image_url: imageUrl,
    iiif_manifest_url: imageUrl?.includes("deliveryService?id=")
      ? "https://ids.si.edu/ids/iiif/" + imageUrl.split("id=")[1]
      : null,
    image_license: rights ? `Smithsonian, ${rights}` : "Smithsonian, CC0",
    source_url: clean(dnr.record_link),
    artist_source_id: artistId,
  };

  const artist: Artist = {
    source_id: artistId,
    name: parsed.name,
    birth_year: parsed.birth,
    death_year: parsed.death,
    nationality: parsed.nationality,
  };

  return { artwork, artist };
}

async function fetchUnit(
  unit: UnitDef,
  apiKey: string,
  cap: number,
  delayMs: number,
): Promise<{ artworks: MappedArtwork[]; artists: Map<string, Artist>; scanned: number }> {
  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, Artist>();
  let start = 0;
  let scanned = 0;

  while (artworks.length < cap) {
    const q = encodeURIComponent(
      `unit_code:${unit.code} AND online_media_type:"Images"`,
    );
    const url = `${API}?q=${q}&rows=${PAGE_SIZE}&start=${start}&api_key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Smithsonian API ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as SearchResponse;
    const rows = json.response?.rows ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (artworks.length >= cap) break;
      scanned++;
      const mapped = mapRecord(row, unit.code);
      if (!mapped) continue;
      artworks.push(mapped.artwork);
      if (!artists.has(mapped.artist.source_id)) {
        artists.set(mapped.artist.source_id, mapped.artist);
      }
    }

    start += PAGE_SIZE;
    if (start >= json.response.rowCount) break;
    if (delayMs > 0) await sleep(delayMs);
  }

  return { artworks, artists, scanned };
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
    `[ingest:smithsonian] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );
  const apiKey = loadApiKey();

  // Round-robin: allocate roughly equally across art units. Units that have
  // fewer publishable records simply contribute fewer.
  const perUnitCap = Math.ceil(args.limit / UNITS.length);

  const allArtworks: MappedArtwork[] = [];
  const allArtists = new Map<string, Artist>();
  let totalScanned = 0;

  for (const unit of UNITS) {
    if (allArtworks.length >= args.limit) break;
    const remaining = args.limit - allArtworks.length;
    const cap = Math.min(perUnitCap, remaining);
    const { artworks, artists, scanned } = await fetchUnit(
      unit,
      apiKey,
      cap,
      args.delayMs,
    );
    totalScanned += scanned;
    console.log(
      `[ingest:smithsonian] ${unit.code}: scanned ${scanned}, mapped ${artworks.length}`,
    );
    allArtworks.push(...artworks);
    for (const [id, a] of artists) {
      if (!allArtists.has(id)) allArtists.set(id, a);
    }
  }

  console.log(
    `[ingest:smithsonian] total: scanned ${totalScanned}, mapped ${allArtworks.length} artworks, ${allArtists.size} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:smithsonian] DRY RUN: sample of 3 artworks:\n");
    for (const sample of allArtworks.slice(0, 3)) {
      const { unit_code, ...rest } = sample;
      console.log(`(${unit_code})`, JSON.stringify(rest, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  // One institution row per art unit, upserted by (source, source_id).
  const institutionRows = UNITS.map((u) => ({
    source: SOURCE,
    source_id: `institution:${u.code}`,
    name: u.name,
    type: "museum",
    city: u.city,
    country: u.country,
    website: u.website,
    source_url: u.website,
  }));
  const upsertedInstitutions = await chunkedUpsert(
    supabase,
    "institutions",
    institutionRows as unknown as Record<string, unknown>[],
    "id,source_id",
  );
  const institutionIdBySourceId = new Map<string, string>(
    upsertedInstitutions.map((row) => [row.source_id as string, row.id as string]),
  );
  console.log(
    `[ingest:smithsonian] upserted ${upsertedInstitutions.length} institutions`,
  );

  const artistRows = [...allArtists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    name: a.name,
    birth_year: a.birth_year,
    death_year: a.death_year,
    nationality: a.nationality,
    source_url: "https://www.si.edu",
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
  console.log(`[ingest:smithsonian] upserted ${upsertedArtists.length} artists`);

  const artworkInsertRows = allArtworks.map((artwork) => {
    const { artist_source_id, unit_code, ...rest } = artwork;
    return {
      ...rest,
      artist_id: artistIdBySourceId.get(artist_source_id) ?? null,
      current_institution_id:
        institutionIdBySourceId.get(`institution:${unit_code}`) ?? null,
    };
  });
  const upsertedArtworks = await chunkedUpsert(
    supabase,
    "artworks",
    artworkInsertRows as unknown as Record<string, unknown>[],
    "id",
  );
  console.log(
    `[ingest:smithsonian] upserted ${upsertedArtworks.length} artworks`,
  );
  console.log(
    "[ingest:smithsonian] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:smithsonian] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
