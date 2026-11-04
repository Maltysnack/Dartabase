// Config-driven ingestion adapter for Finnish National Gallery (Kansallisgalleria)
// museums published through Finna, Finland's open national API (api.finna.fi,
// no key required). One museum per `--museum` key; pick the building below.
//
//   pnpm ingest:kiasma -- --dry-run --limit 50
//   pnpm ingest:sinebrychoff -- --limit 5000
//
// The Ateneum (the third Kansallisgalleria museum) has its own adapter,
// scripts/ingest-ateneum.ts; it can fold into this one in a follow-up.
//
// Images: Finna reports an explicit licence per record (imageRights.copyright).
// We store the image URL ONLY when that licence is open (CC0, CC BY, CC BY-SA,
// public domain) and record it in image_license; in-copyright ("InC") and
// NonCommercial/NoDerivatives images are omitted and the record stays
// metadata-only, linking to its Finna page. We mirror only what each museum has
// openly published. (next.config must list api.finna.fi for thumbnails to
// display; added in the Ateneum PR.)
//
// Upserts key on (source, source_id). Re-running is safe.

import { createAdminClient } from "./lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const API = "https://api.finna.fi/v1/search";
const PAGE_SIZE = 100;
const UPSERT_CHUNK = 500;
const PAGE_DELAY_MS = 250;

interface MuseumConfig {
  source: string;
  building: string;
  institution: {
    source: string;
    source_id: string;
    name: string;
    type: string;
    city: string;
    country: string;
    website: string;
    source_url: string;
  };
}

export const MUSEUMS: Record<string, MuseumConfig> = {
  kiasma: {
    source: "kiasma",
    building: "0/Kansallisgalleria Nykytaiteen museo Kiasma/",
    institution: {
      source: "kiasma",
      source_id: "institution:kiasma",
      name: "Museum of Contemporary Art Kiasma",
      type: "museum",
      city: "Helsinki",
      country: "Finland",
      website: "https://kiasma.fi/",
      source_url: "https://kiasma.fi/",
    },
  },
  sinebrychoff: {
    source: "sinebrychoff",
    building: "0/Kansallisgalleria Sinebrychoffin taidemuseo/",
    institution: {
      source: "sinebrychoff",
      source_id: "institution:sinebrychoff",
      name: "Sinebrychoff Art Museum",
      type: "museum",
      city: "Helsinki",
      country: "Finland",
      website: "https://sinebrychoffintaidemuseo.fi/",
      source_url: "https://sinebrychoffintaidemuseo.fi/",
    },
  },
  serlachius: {
    source: "serlachius",
    building: "0/Gösta Serlachiuksen taidesäätiö/",
    institution: {
      source: "serlachius",
      source_id: "institution:serlachius",
      name: "Serlachius Museums",
      type: "museum",
      city: "Mänttä",
      country: "Finland",
      website: "https://serlachius.fi/",
      source_url: "https://serlachius.fi/",
    },
  },
  gallenkallela: {
    source: "gallenkallela",
    building: "0/GallenKallela/",
    institution: {
      source: "gallenkallela",
      source_id: "institution:gallenkallela",
      name: "Gallen-Kallela Museum",
      type: "museum",
      city: "Espoo",
      country: "Finland",
      website: "https://www.gallen-kallela.fi/",
      source_url: "https://www.gallen-kallela.fi/",
    },
  },
};

// Finna's WorkOfArt sub-format mapped to a medium label; falls back to the raw
// sub-format token when unmapped.
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
  museum: string;
  limit: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let museum: string | undefined;
  let limit: number | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--museum") museum = argv[++i];
    else if (arg === "--limit") limit = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!museum || !MUSEUMS[museum]) {
    throw new Error(
      `--museum <key> is required, one of: ${Object.keys(MUSEUMS).join(", ")}`,
    );
  }
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      "--limit <n> is required (a positive integer).\n" +
        "Example: pnpm ingest:kiasma -- --dry-run --limit 50",
    );
  }
  return { museum, limit, dryRun };
}

export function clean(value: string | undefined | null): string | null {
  const s = (value ?? "").trim();
  return s || null;
}

// Open licences whose image we may mirror as a thumbnail. NonCommercial (-NC)
// and NoDerivatives (-ND) variants and in-copyright records are excluded.
export function isOpenLicence(copyright: string | undefined | null): boolean {
  const c = (copyright ?? "").trim();
  if (!c) return false;
  const upper = c.toUpperCase();
  if (upper.startsWith("CC0")) return true;
  if (upper.startsWith("PDM") || upper.includes("PUBLIC DOMAIN")) return true;
  if (upper.startsWith("CC BY")) return !/-NC|-ND/i.test(c);
  return false;
}

// "Surname, Given" -> { name: "Given Surname", sortName: "Surname, Given" }.
export function parsePerson(
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

export function parseYear(value: string | undefined): number | null {
  const m = (value ?? "").match(/\b(\d{4})\b/);
  if (!m) return null;
  const year = Number(m[1]);
  return year >= 1 && year <= new Date().getFullYear() ? year : null;
}

// formats: [{value:"0/WorkOfArt/"}, {value:"1/WorkOfArt/Painting/"}] -> medium.
export function parseMedium(
  formats: { value: string }[] | undefined,
): string | null {
  const sub = (formats ?? []).find((f) => f.value.startsWith("1/WorkOfArt/"));
  if (!sub) return null;
  const key = sub.value.split("/").filter(Boolean)[2];
  if (!key) return null;
  return FORMAT_MEDIUM[key] ?? key;
}

// measurements: ["teosmitat: 15,5 x 24,5 cm"] -> "15,5 x 24,5 cm".
export function parseDimensions(
  measurements: string[] | undefined,
): string | null {
  const first = (measurements ?? [])[0];
  if (!first) return null;
  const colon = first.indexOf(": ");
  const value = colon !== -1 ? first.slice(colon + 2).trim() : first.trim();
  return value && /\d/.test(value) ? value : null;
}

export interface FinnaRecord {
  id: string;
  title?: string;
  year?: string;
  nonPresenterAuthors?: { name: string; role?: string }[];
  images?: string[];
  imageRights?: { copyright?: string };
  formats?: { value: string }[];
  measurements?: string[];
}

export interface MappedArtwork {
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

export interface Artist {
  source_id: string;
  name: string;
  sort_name: string | null;
  nationality: null;
}

export function mapRecord(
  rec: FinnaRecord,
  source: string,
): { artwork: MappedArtwork; artist: Artist } | null {
  const title = clean(rec.title);
  if (!title) return null;

  const person = parsePerson(rec.nonPresenterAuthors?.[0]?.name ?? "");
  if (!person) return null;

  const open = isOpenLicence(rec.imageRights?.copyright);
  const imagePath = rec.images?.[0];
  const imageUrl = open && imagePath ? `https://api.finna.fi${imagePath}` : null;
  const artistSourceId = `artist:${person.name.toLowerCase().trim()}`;

  return {
    artwork: {
      source,
      source_id: rec.id,
      title,
      date_text: clean(rec.year),
      date_year: parseYear(rec.year),
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

async function fetchPage(building: string, page: number): Promise<FinnaRecord[]> {
  const params = new URLSearchParams();
  params.append("filter[]", `building:"${building}"`);
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
  const url = `${API}?${params.toString()}`;
  // Retry transient server/network errors so a single hiccup (Finna returns the
  // odd 500) does not abort a multi-thousand-page ingestion. Fail fast on 4xx.
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      status = res.status;
      if (res.ok) {
        const data = (await res.json()) as { records?: FinnaRecord[] };
        return data.records ?? [];
      }
    } catch {
      // network error: fall through to the retry decision below
    }
    if ((status >= 400 && status < 500) || attempt >= 4) {
      throw new Error(`Finna API ${status || "request failed"} on page ${page}`);
    }
    await sleep(400 * attempt);
  }
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
  const cfg = MUSEUMS[args.museum];
  const tag = `ingest:${cfg.source}`;
  console.log(`[${tag}] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`);

  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, Artist>();
  let page = 1;
  let withImage = 0;

  while (artworks.length < args.limit) {
    const records = await fetchPage(cfg.building, page);
    if (records.length === 0) break;
    for (const rec of records) {
      if (artworks.length >= args.limit) break;
      const mapped = mapRecord(rec, cfg.source);
      if (!mapped) continue;
      artworks.push(mapped.artwork);
      if (mapped.artwork.image_url) withImage++;
      if (!artists.has(mapped.artist.source_id)) {
        artists.set(mapped.artist.source_id, mapped.artist);
      }
    }
    console.log(`[${tag}] page ${page}: ${artworks.length} artworks so far`);
    page++;
    if (artworks.length < args.limit) await sleep(PAGE_DELAY_MS);
  }

  console.log(
    `[${tag}] mapped ${artworks.length} artworks ` +
      `(${withImage} with an openly-licensed image), ${artists.size} artists`,
  );

  if (args.dryRun) {
    console.log(`\n[${tag}] DRY RUN: sample of 3 artworks:\n`);
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(cfg.institution, { onConflict: "source,source_id" })
    .select("id")
    .single();
  if (instError) throw new Error(`upsert institution: ${instError.message}`);
  const institutionId = inst.id as string;

  const artistRows = [...artists.values()].map((a) => ({
    source: cfg.source,
    source_id: a.source_id,
    name: a.name,
    sort_name: a.sort_name,
    nationality: a.nationality,
    source_url: cfg.institution.website,
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
  console.log(`[${tag}] upserted ${upsertedArtists.length} artists`);

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
  console.log(`[${tag}] upserted ${upsertedArtworks.length} artworks`);
  console.log(`[${tag}] done. Run \`pnpm dedup\` to fold cross-source duplicates.`);
}

// Only run when executed directly (not when imported by the test).
if (process.argv[1] && process.argv[1].endsWith("ingest-finna.ts")) {
  main().catch((err: unknown) => {
    console.error(
      "[ingest:finna] FAILED:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
