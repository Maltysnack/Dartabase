// Ingestion adapter for the Ateneum Art Museum (Finnish National Gallery,
// Kansallisgalleria), Helsinki.
//
// Data source: Finna, the open API of the Finnish national discovery service
// (api.finna.fi). No API key required.
//   https://api.finna.fi/v1/search
// Filtered to building "Kansallisgalleria Ateneumin taidemuseo" and
// format "WorkOfArt" (~28,800 records).
//
// Images: Finna exposes a per-record image plus an explicit licence
// (imageRights.copyright). We store the image URL ONLY when that licence is
// open (CC0, CC BY, CC BY-SA, or public domain); in-copyright ("InC") and
// NonCommercial / NoDerivatives images are left out and the record stays
// metadata-only, linking back to its Finna page. This mirrors only what the
// museum has openly published. image_license records the licence per work.
//
// Titles and artist names are kept as published (Finnish/Swedish where the
// museum records them so). Upserts key on (source, source_id) with
// source = 'ateneum'. Re-running is safe.
//
// Examples:
//   pnpm ingest:ateneum -- --dry-run --limit 50
//   pnpm ingest:ateneum -- --limit 5000

import { createAdminClient } from "./lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "ateneum";
const API = "https://api.finna.fi/v1/search";
const BUILDING = '"0/Kansallisgalleria Ateneumin taidemuseo/"';
const PAGE_SIZE = 100;
const UPSERT_CHUNK = 500;
const PAGE_DELAY_MS = 250;

// Finna's WorkOfArt sub-format (the "1/WorkOfArt/X/" facet) mapped to a medium
// label. Falls back to the raw sub-format when unmapped.
const FORMAT_MEDIUM: Record<string, string> = {
  Painting: "Painting",
  Drawing: "Drawing",
  Graphic: "Print",
  Print: "Print",
  Sculpture: "Sculpture",
  Photograph: "Photograph",
  Installation: "Installation",
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
      "--limit <n> is required (a positive integer).\n" +
        "Example: pnpm ingest:ateneum -- --dry-run --limit 50",
    );
  }
  return { limit, dryRun };
}

function clean(value: string | undefined | null): string | null {
  const s = (value ?? "").trim();
  return s || null;
}

// Open licences whose image we may mirror as a thumbnail. NonCommercial (-NC)
// and NoDerivatives (-ND) variants and in-copyright records are excluded.
function isOpenLicence(copyright: string | undefined | null): boolean {
  const c = (copyright ?? "").trim();
  if (!c) return false;
  const upper = c.toUpperCase();
  if (upper.startsWith("CC0")) return true;
  if (upper.startsWith("PDM") || upper.includes("PUBLIC DOMAIN")) return true;
  if (upper.startsWith("CC BY")) return !/-NC|-ND/i.test(c);
  return false;
}

// "Surname, Given" -> { name: "Given Surname", sortName: "Surname, Given" }.
function parsePerson(
  raw: string,
): { name: string; sortName: string | null } | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const comma = value.indexOf(", ");
  if (comma === -1) return { name: value, sortName: null };
  const last = value.slice(0, comma).trim();
  const given = value.slice(comma + 2).trim();
  if (!given) return { name: last, sortName: null };
  return { name: `${given} ${last}`, sortName: `${last}, ${given}` };
}

function parseYear(value: string | undefined): number | null {
  const m = (value ?? "").match(/\b(\d{4})\b/);
  if (!m) return null;
  const year = Number(m[1]);
  return year >= 1 && year <= new Date().getFullYear() ? year : null;
}

// formats: [{value:"0/WorkOfArt/"}, {value:"1/WorkOfArt/Painting/"}] -> medium.
function parseMedium(formats: { value: string }[] | undefined): string | null {
  const sub = (formats ?? []).find((f) => f.value.startsWith("1/WorkOfArt/"));
  if (!sub) return null;
  const parts = sub.value.split("/").filter(Boolean); // ["1","WorkOfArt","Painting"]
  const key = parts[2];
  if (!key) return null;
  return FORMAT_MEDIUM[key] ?? key;
}

// measurements: ["teosmitat: 15,5 x 24,5 cm"] -> "15,5 x 24,5 cm".
function parseDimensions(measurements: string[] | undefined): string | null {
  const first = (measurements ?? [])[0];
  if (!first) return null;
  const colon = first.indexOf(": ");
  const value = colon !== -1 ? first.slice(colon + 2).trim() : first.trim();
  return value && /\d/.test(value) ? value : null;
}

interface FinnaRecord {
  id: string;
  title?: string;
  year?: string;
  nonPresenterAuthors?: { name: string; role?: string }[];
  images?: string[];
  imageRights?: { copyright?: string };
  formats?: { value: string }[];
  measurements?: string[];
}

interface MappedArtwork {
  source: string;
  source_id: string;
  title: string;
  date_text: string | null;
  date_year: number | null;
  medium: string | null;
  dimensions: string | null;
  credit_line: null;
  image_url: string | null;
  image_license: string | null;
  source_url: string;
  artist_source_id: string;
}

interface Artist {
  source_id: string;
  name: string;
  sort_name: string | null;
  nationality: null;
}

const ATENEUM_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:ateneum",
  name: "Ateneum Art Museum",
  type: "museum",
  city: "Helsinki",
  country: "Finland",
  website: "https://ateneum.fi/",
  source_url: "https://www.finna.fi/Organisation/ateneum",
};

function mapRecord(
  rec: FinnaRecord,
): { artwork: MappedArtwork; artist: Artist } | null {
  const title = clean(rec.title);
  if (!title) return null;

  const person = parsePerson(rec.nonPresenterAuthors?.[0]?.name ?? "");
  if (!person) return null;

  const open = isOpenLicence(rec.imageRights?.copyright);
  const imagePath = rec.images?.[0];
  const imageUrl = open && imagePath ? `https://api.finna.fi${imagePath}` : null;

  const artistSourceId = `artist:${person.name.toLowerCase().trim()}`;
  const dateYear = parseYear(rec.year);

  return {
    artwork: {
      source: SOURCE,
      source_id: rec.id,
      title,
      date_text: clean(rec.year),
      date_year: dateYear,
      medium: parseMedium(rec.formats),
      dimensions: parseDimensions(rec.measurements),
      credit_line: null,
      image_url: imageUrl,
      image_license: imageUrl ? (rec.imageRights?.copyright ?? null) : null,
      source_url: `https://www.finna.fi/Record/${encodeURIComponent(rec.id)}`,
      artist_source_id: artistSourceId,
    },
    artist: {
      source_id: artistSourceId,
      name: person.name,
      sort_name: person.sortName,
      nationality: null,
    },
  };
}

async function fetchPage(page: number): Promise<FinnaRecord[]> {
  const params = new URLSearchParams();
  params.append("filter[]", `building:${BUILDING}`);
  params.append("filter[]", `format:"0/WorkOfArt/"`);
  for (const f of [
    "id",
    "title",
    "year",
    "nonPresenterAuthors",
    "images",
    "imageRights",
    "formats",
    "measurements",
  ]) {
    params.append("field[]", f);
  }
  params.set("limit", String(PAGE_SIZE));
  params.set("page", String(page));
  const res = await fetch(`${API}?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Finna API ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { records?: FinnaRecord[] };
  return data.records ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    `[ingest:ateneum] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, Artist>();
  let page = 1;
  let withImage = 0;

  while (artworks.length < args.limit) {
    const records = await fetchPage(page);
    if (records.length === 0) break;
    for (const rec of records) {
      if (artworks.length >= args.limit) break;
      const mapped = mapRecord(rec);
      if (!mapped) continue;
      artworks.push(mapped.artwork);
      if (mapped.artwork.image_url) withImage++;
      if (!artists.has(mapped.artist.source_id)) {
        artists.set(mapped.artist.source_id, mapped.artist);
      }
    }
    console.log(
      `[ingest:ateneum] page ${page}: ${artworks.length} artworks so far`,
    );
    page++;
    if (artworks.length < args.limit) await sleep(PAGE_DELAY_MS);
  }

  console.log(
    `[ingest:ateneum] mapped ${artworks.length} artworks ` +
      `(${withImage} with an openly-licensed image), ${artists.size} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:ateneum] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(ATENEUM_INSTITUTION, { onConflict: "source,source_id" })
    .select("id")
    .single();
  if (instError) throw new Error(`upsert institution: ${instError.message}`);
  const institutionId = inst.id as string;

  const artistRows = [...artists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    name: a.name,
    sort_name: a.sort_name,
    nationality: a.nationality,
    source_url: "https://ateneum.fi/",
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
  console.log(`[ingest:ateneum] upserted ${upsertedArtists.length} artists`);

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
  console.log(`[ingest:ateneum] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:ateneum] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:ateneum] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
