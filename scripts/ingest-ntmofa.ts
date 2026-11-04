// Ingestion adapter for the National Taiwan Museum of Fine Arts (NTMOFA).
//
// Data source: Ministry of Culture Open Data Portal
// URL: https://collections.culture.tw/getMetadataList.aspx?FORMAT=OpenData&DN=ntmofa
// License: CC BY 4.0 (Taiwan Open Government Data)
//
// The API returns a single JSON array (~14,500 records, ~18MB). No pagination.
// Titles and artist names are in Traditional Chinese; they are stored as-is.
// The Type field ("藝術類\油畫") is parsed to an English medium label.
//
// Note: the ImageUrl field in the export uses a token-based endpoint
// (ShowGALImage.aspx) that returns 404 for external requests. Images are
// not stored; source_url links to the NTMOFA collections portal per record.
//
// Upserts key on (source, source_id) with source = 'ntmofa'. Re-running is safe.
//
// Examples:
//   pnpm ingest:ntmofa -- --dry-run --limit 50
//   pnpm ingest:ntmofa -- --limit 5000
//   pnpm ingest:ntmofa -- --limit 14552   (full collection)

import { createAdminClient } from "./lib/supabase-admin";
import { yearFromText } from "./lib/year";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "ntmofa";
const API_URL =
  "https://collections.culture.tw/getMetadataList.aspx?FORMAT=OpenData&DN=ntmofa";
const UPSERT_CHUNK = 500;

// Map Chinese medium/type suffixes (after the backslash) to English labels.
const MEDIUM_MAP: Record<string, string> = {
  油畫: "Oil painting",
  水彩畫: "Watercolor",
  水墨: "Ink wash",
  素描: "Drawing",
  版畫: "Printmaking",
  書法: "Calligraphy",
  攝影: "Photography",
  複合媒材: "Mixed media",
  膠彩畫: "Gouache",
  雕塑: "Sculpture",
  陶藝: "Ceramics",
  新媒體藝術: "New media",
  壓克力畫: "Acrylic",
  粉彩畫: "Pastel",
  篆刻: "Seal engraving",
  應用美術: "Applied arts",
  裝置藝術: "Installation",
  工藝美術: "Craft",
  觀念藝術: "Conceptual art",
  其他: "Other",
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
        "Example: pnpm ingest:ntmofa -- --dry-run --limit 50",
    );
  }
  return { limit, dryRun };
}

function clean(value: string | undefined | null): string | null {
  const s = (value ?? "").replace(/\r\n?/g, "\n").trim();
  return s || null;
}

// Parse "藝術類\油畫" -> "Oil painting". Returns null if unrecognised.
function parseMedium(raw: string): string | null {
  const sep = raw.lastIndexOf("\\");
  const suffix = sep !== -1 ? raw.slice(sep + 1).trim() : raw.trim();
  return MEDIUM_MAP[suffix] ?? null;
}

// Parse "200.5 x 300.5 cm" or "200.5 x 300.5" -> return as-is if well-formed.
function parseDimensions(raw: string): string | null {
  const s = clean(raw);
  if (!s) return null;
  // Only keep strings that look like measurement data.
  if (!/\d/.test(s)) return null;
  return s;
}

interface NtmofaRecord {
  Identifier: string;
  MainTitle: string;
  Creator: string;
  CreatedYear: string;
  Size: string;
  Type: string;
  Owner: string;
  AcquiredDate: string;
  OriginalUrl: string;
  OwnerCollectionsWebsite: string;
  OwnerWebsite: string;
  ApplicationGuide: string;
  Description: string;
  ImageUrl: string;
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
  source_url: string | null;
  artist_source_id: string;
}

interface Artist {
  source_id: string;
  name: string;
  birth_year: null;
  death_year: null;
  nationality: null;
}

const NTMOFA_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:ntmofa",
  name: "National Taiwan Museum of Fine Arts",
  type: "museum",
  city: "Taichung",
  country: "Taiwan",
  website: "https://www.ntmofa.gov.tw/",
  source_url: "https://collections.culture.tw/",
};

function mapRecord(
  rec: NtmofaRecord,
): { artwork: MappedArtwork; artist: Artist } | null {
  const title = clean(rec.MainTitle);
  if (!title) return null;

  const creatorName = clean(rec.Creator);
  if (!creatorName) return null;

  const dateText = clean(rec.CreatedYear);
  const dateYear = yearFromText(dateText);

  const dimensions = parseDimensions(rec.Size);
  const medium = parseMedium(rec.Type);
  const sourceUrl = clean(rec.OriginalUrl);

  // Derive a stable artist source_id from the creator name.
  const artistSourceId = `artist:${creatorName.replace(/\s+/g, "-")}`;

  return {
    artwork: {
      source: SOURCE,
      source_id: rec.Identifier,
      title,
      date_text: dateText,
      date_year: dateYear,
      medium,
      dimensions,
      credit_line: null,
      image_url: null,
      image_license: null,
      source_url: sourceUrl,
      artist_source_id: artistSourceId,
    },
    artist: {
      source_id: artistSourceId,
      name: creatorName,
      birth_year: null,
      death_year: null,
      nationality: null,
    },
  };
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
    `[ingest:ntmofa] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  console.log("[ingest:ntmofa] fetching full dataset...");
  const res = await fetch(API_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`NTMOFA API ${res.status} ${res.statusText}`);
  }
  const all = (await res.json()) as NtmofaRecord[];
  console.log(`[ingest:ntmofa] fetched ${all.length} records`);

  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, Artist>();

  for (const rec of all) {
    if (artworks.length >= args.limit) break;
    const mapped = mapRecord(rec);
    if (!mapped) continue;
    artworks.push(mapped.artwork);
    if (!artists.has(mapped.artist.source_id)) {
      artists.set(mapped.artist.source_id, mapped.artist);
    }
  }

  const withImage = artworks.filter((a) => a.image_url != null).length;
  console.log(
    `[ingest:ntmofa] mapped ${artworks.length} artworks ` +
      `(${withImage} with image), ${artists.size} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:ntmofa] DRY RUN: sample of 3 artworks:\n");
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
    .upsert(NTMOFA_INSTITUTION, { onConflict: "source,source_id" })
    .select("id")
    .single();
  if (instError) throw new Error(`upsert institution: ${instError.message}`);
  const institutionId = inst.id as string;

  const artistRows = [...artists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    name: a.name,
    birth_year: a.birth_year,
    death_year: a.death_year,
    nationality: a.nationality,
    source_url: "https://www.ntmofa.gov.tw/",
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
  console.log(`[ingest:ntmofa] upserted ${upsertedArtists.length} artists`);

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
  console.log(`[ingest:ntmofa] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:ntmofa] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:ntmofa] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
