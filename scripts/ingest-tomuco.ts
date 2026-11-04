// Ingestion adapter for ToMuCo (Tokyo Museum Collection).
// Covers six Tokyo metropolitan museums: Edo-Tokyo Museum, Tokyo Photographic
// Art Museum, Museum of Contemporary Art Tokyo, Tokyo Metropolitan Teien Art
// Museum, Tokyo Metropolitan Art Museum, and Edo-Tokyo Open-Air Architectural
// Museum.
//
// Uses the public JSON-LD API at museumcollection.tokyo (no auth required).
// Metadata is CC0 / public domain. Images are not available via the API, so
// this is a metadata-only ingest. Only works with an identified creator and an
// English title are ingested; anonymous/untitled works are skipped.
//
// Examples:
//   pnpm ingest:tomuco -- --dry-run --limit 20
//   pnpm ingest:tomuco -- --limit 2000

import { createAdminClient } from "./lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "tomuco";
const UPSERT_CHUNK = 500;
const API_BASE = "https://museumcollection.tokyo/works/";
const PAGE_SIZE = 1000;

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
        "Example: pnpm ingest:tomuco -- --dry-run --limit 20",
    );
  }
  return { limit, delayMs, dryRun };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Prefer English text from a multilingual array. Falls back to Japanese.
function pickLang(
  values: unknown,
  preferred = "en",
): string {
  if (!values) return "";
  const arr = Array.isArray(values) ? values : [values];
  const found = arr.find(
    (v): v is { "@value": string; "@lang": string } =>
      typeof v === "object" && v !== null && "@value" in v && (v as Record<string, string>)["@lang"] === preferred,
  );
  if (found) return (found as { "@value": string })["@value"].trim();
  // Fall back to any language.
  const fallback = arr.find(
    (v): v is { "@value": string } =>
      typeof v === "object" && v !== null && "@value" in v,
  );
  return fallback ? (fallback as { "@value": string })["@value"].trim() : "";
}

// Strip Japanese CJK characters and clean up dimension strings.
// "130(高さ、縦)×220(幅、横) cm" -> "130 x 220 cm"
function cleanDimensions(raw: string): string {
  return raw
    // Remove parenthesised Japanese labels like (高さ、縦)
    .replace(/\([^)]*[　-鿿][^)]*\)/g, "")
    // Remove bare CJK characters
    .replace(/[　-鿿＀-￯]+/g, "")
    // Normalise × and x variants
    .replace(/[×x]/gi, " x ")
    // Collapse extra whitespace
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Parse a 4-digit year from strings like "1933", "ca. 1880", "1880-1900".
function yearFrom(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = s.match(/\b(\d{4})\b/);
  return m ? parseInt(m[1], 10) : null;
}

type RawItem = Record<string, unknown>;

interface MappedArtwork {
  source: string;
  source_id: string;
  title: string;
  date_text: string | null;
  date_year: number | null;
  medium: string | null;
  dimensions: string | null;
  credit_line: string | null;
  image_url: null;
  image_license: null;
  source_url: string | null;
  artist_source_id: string;
  institution_key: string;
}

interface MappedArtist {
  source_id: string;
  name: string;
  birth_year: number | null;
  death_year: number | null;
  nationality: string | null;
}

function mapItem(item: RawItem): { artwork: MappedArtwork; artist: MappedArtist } | null {
  // TMC ID.
  const identifiers = (item["schema:identifier"] ?? []) as RawItem[];
  const tmcId = identifiers.find((i) => i["schema:name"] === "TMC ID")?.[
    "schema:value"
  ] as string | undefined;
  if (!tmcId) return null;

  // Title (English preferred).
  const title = pickLang(item["schema:name"]);
  if (!title) return null;

  // Creator (required).
  const creator = item["schema:creator"] as RawItem | undefined;
  if (!creator || typeof creator !== "object") return null;
  const artistName = pickLang(creator["schema:name"]);
  if (!artistName) return null;

  // Use artistName as source_id (unique enough at this level).
  const artistSourceId = `tomuco:artist:${artistName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`;

  // Birth / death years.
  const birthRaw = (creator["schema:birthDate"] as { "@value"?: string } | string | undefined);
  const deathRaw = (creator["schema:deathDate"] as { "@value"?: string } | string | undefined);
  const birthStr = typeof birthRaw === "object" ? birthRaw?.["@value"] : birthRaw;
  const deathStr = typeof deathRaw === "object" ? deathRaw?.["@value"] : deathRaw;

  // Date.
  const dateCreated = item["schema:dateCreated"] as string | undefined;
  const dateText = dateCreated?.trim() ?? null;

  // Medium (English).
  const medium = pickLang(item["schema:material"]) || null;

  // Dimensions.
  let dimensions: string | null = null;
  const rawSize = item["schema:size"];
  if (typeof rawSize === "string" && rawSize) {
    dimensions = cleanDimensions(rawSize) || null;
  } else if (rawSize && typeof rawSize === "object") {
    const sizeVal = (rawSize as Record<string, string>)["value"];
    if (sizeVal) dimensions = cleanDimensions(sizeVal) || null;
  }

  // Institution.
  const parts = item["schema:isPartOf"];
  const partsArr = Array.isArray(parts) ? parts : parts ? [parts] : [];
  let institutionKey = "";
  for (const part of partsArr as RawItem[]) {
    const maintainers = part["schema:maintainer"];
    const maintainersArr = Array.isArray(maintainers)
      ? maintainers
      : maintainers
        ? [maintainers]
        : [];
    for (const org of maintainersArr as RawItem[]) {
      const en = pickLang(org["schema:name"]);
      if (en) {
        institutionKey = en;
        break;
      }
    }
    if (institutionKey) break;
  }
  if (!institutionKey) return null;

  const sourceUrl = (item["@id"] as string) ?? null;

  return {
    artwork: {
      source: SOURCE,
      source_id: tmcId,
      title,
      date_text: dateText,
      date_year: yearFrom(dateText),
      medium,
      dimensions,
      credit_line: null,
      image_url: null,
      image_license: null,
      source_url: sourceUrl,
      artist_source_id: artistSourceId,
      institution_key: institutionKey,
    },
    artist: {
      source_id: artistSourceId,
      name: artistName,
      birth_year: yearFrom(birthStr),
      death_year: yearFrom(deathStr),
      nationality: null,
    },
  };
}

// Known ToMuCo institutions with canonical metadata.
const KNOWN_INSTITUTIONS: Record<string, {
  name: string;
  city: string;
  website: string;
}> = {
  "Edo-Tokyo Museum": {
    name: "Edo-Tokyo Museum",
    city: "Tokyo",
    website: "https://www.edotokyo-museum.or.jp/en/",
  },
  "Tokyo Photographic Art Museum": {
    name: "Tokyo Photographic Art Museum",
    city: "Tokyo",
    website: "https://topmuseum.jp/e/",
  },
  "Museum of Contemporary Art Tokyo": {
    name: "Museum of Contemporary Art Tokyo",
    city: "Tokyo",
    website: "https://www.mot-art-museum.jp/en/",
  },
  "Tokyo Metropolitan Teien Art Museum": {
    name: "Tokyo Metropolitan Teien Art Museum",
    city: "Tokyo",
    website: "https://www.teien-art-museum.ne.jp/en/",
  },
  "Tokyo Metropolitan Art Museum": {
    name: "Tokyo Metropolitan Art Museum",
    city: "Tokyo",
    website: "https://www.tobikan.jp/en/",
  },
  "Edo-Tokyo Open-Air Architectural Museum": {
    name: "Edo-Tokyo Open-Air Architectural Museum",
    city: "Tokyo",
    website: "https://www.tatemonoen.jp/english/",
  },
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[ingest:tomuco] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, MappedArtist>();
  let offset = 0;

  while (artworks.length < args.limit) {
    const url = `${API_BASE}?output=json&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`ToMuCo API ${res.status} at offset ${offset}`);
    }

    const json = (await res.json()) as Record<string, unknown>;

    // When limit=1 the API returns a single object at the root; otherwise @graph.
    let items: RawItem[];
    if (Array.isArray(json["@graph"])) {
      items = json["@graph"] as RawItem[];
    } else if (json["@type"] === "schema:CreativeWork") {
      items = [json as RawItem];
    } else {
      break;
    }

    if (items.length === 0) break;

    for (const item of items) {
      if (artworks.length >= args.limit) break;
      const mapped = mapItem(item);
      if (!mapped) continue;
      artworks.push(mapped.artwork);
      if (!artists.has(mapped.artist.source_id)) {
        artists.set(mapped.artist.source_id, mapped.artist);
      }
    }

    if (items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    await sleep(args.delayMs);
  }

  const distinctInstitutions = [...new Set(artworks.map((a) => a.institution_key))];

  console.log(
    `[ingest:tomuco] mapped ${artworks.length} artworks, ` +
      `${artists.size} artists, ` +
      `${distinctInstitutions.length} institutions`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:tomuco] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  // Upsert institutions and build key -> id map.
  const institutionIdByKey = new Map<string, string>();
  for (const key of distinctInstitutions) {
    const meta = KNOWN_INSTITUTIONS[key] ?? {
      name: key,
      city: "Tokyo",
      website: "https://museumcollection.tokyo",
    };
    const row = {
      source: SOURCE,
      source_id: `institution:${key.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`,
      name: meta.name,
      type: "museum",
      city: meta.city,
      country: "Japan",
      website: meta.website,
      source_url: "https://museumcollection.tokyo",
    };
    const { data, error } = await supabase
      .from("institutions")
      .upsert(row, { onConflict: "source,source_id" })
      .select("id")
      .single();
    if (error) throw new Error(`upsert institution ${key}: ${error.message}`);
    institutionIdByKey.set(key, (data as { id: string }).id);
  }
  console.log(`[ingest:tomuco] upserted ${institutionIdByKey.size} institutions`);

  // Upsert artists.
  const artistRows = [...artists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    name: a.name,
    birth_year: a.birth_year,
    death_year: a.death_year,
    nationality: a.nationality,
    source_url: "https://museumcollection.tokyo",
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
  console.log(`[ingest:tomuco] upserted ${upsertedArtists.length} artists`);

  // Upsert artworks.
  const artworkRows = artworks.map(({ artist_source_id, institution_key, ...rest }) => ({
    ...rest,
    artist_id: artistIdBySourceId.get(artist_source_id) ?? null,
    current_institution_id: institutionIdByKey.get(institution_key) ?? null,
  }));
  const upsertedArtworks = await chunkedUpsert(
    supabase,
    "artworks",
    artworkRows as unknown as Record<string, unknown>[],
    "id",
  );
  console.log(`[ingest:tomuco] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:tomuco] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:tomuco] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
