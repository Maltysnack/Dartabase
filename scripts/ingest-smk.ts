// Ingestion adapter for Statens Museum for Kunst (SMK), the National Gallery
// of Denmark.
//
// Fetches public-domain, image-bearing works from the open SMK API and upserts
// artworks and artists into Supabase. The API needs no key. Only works SMK has
// itself marked public domain and published with an image are mirrored.
// Upserts key on (source, source_id) with source = 'smk', so re-running is
// idempotent.
//
// Examples:
//   pnpm ingest:smk -- --dry-run --limit 10
//   pnpm ingest:smk -- --limit 800

import { createAdminClient } from "./lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clean,
  yearFrom,
  nationality,
  isAnonymousName,
  artistName,
  pickTitle,
  formatDimensions,
  primaryCreator,
  type SmkCreator,
  type SmkTitle,
  type SmkDimension,
  type SmkObject,
} from "./lib/smk-parsers";

const SOURCE = "smk";
const UPSERT_CHUNK = 500;
const API = "https://api.smk.dk/api/v1/art/search/";
const PAGE_SIZE = 100;

// Mirror only what SMK has itself published openly: public domain, with image.
const FILTERS = "[has_image:true],[public_domain:true]"
  .split(",")
  .map(encodeURIComponent)
  .join(",");

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
        "Example: pnpm ingest:smk -- --dry-run --limit 10",
    );
  }
  return { limit, delayMs, dryRun };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface SmkProductionDate {
  start?: string;
  end?: string;
  period?: string;
}

interface SmkObjectExtended extends SmkObject {
  object_number?: string;
  production_date?: SmkProductionDate[];
  techniques?: string[];
  has_image?: boolean;
  image_thumbnail?: string | null;
  frontend_url?: string;
}

interface SmkResponse {
  offset: number;
  rows: number;
  found: number;
  items: SmkObjectExtended[];
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
  title: string;
  date_text: string | null;
  date_year: number | null;
  medium: string | null;
  dimensions: string | null;
  credit_line: string | null;
  image_url: string | null;
  image_license: string | null;
  source_url: string | null;
  artist_source_id: string;
}

const SMK_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:smk",
  name: "Statens Museum for Kunst (National Gallery of Denmark)",
  type: "museum",
  city: "Copenhagen",
  country: "Denmark",
  website: "https://www.smk.dk",
  source_url: "https://www.smk.dk",
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
    `[ingest:smk] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, Artist>();
  let offset = 0;

  while (artworks.length < args.limit) {
    const url = `${API}?keys=*&filters=${FILTERS}&offset=${offset}&rows=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SMK API ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as SmkResponse;
    if (!json.items || json.items.length === 0) break;

    for (const object of json.items) {
      if (artworks.length >= args.limit) break;
      const objectNumber = (object.object_number ?? "").trim();
      if (objectNumber === "") continue;

      const title = pickTitle(object.titles);
      if (!title) continue;

      const creator = primaryCreator(object);
      if (!creator || !creator.creator_lref) continue;
      const name = artistName(object, creator);
      if (isAnonymousName(name)) continue;
      const artistId = creator.creator_lref;
      if (!artists.has(artistId)) {
        artists.set(artistId, {
          source_id: artistId,
          name,
          birth_year: yearFrom(creator.creator_date_of_birth),
          death_year: yearFrom(creator.creator_date_of_death),
          nationality: nationality(creator.creator_nationality),
        });
      }

      const productionDate = (object.production_date ?? [])[0];
      const hasOpenImage =
        object.has_image === true &&
        typeof object.image_thumbnail === "string" &&
        object.image_thumbnail !== "";

      artworks.push({
        source: SOURCE,
        source_id: objectNumber,
        title,
        date_text: productionDate ? clean(productionDate.period) : null,
        date_year: productionDate
          ? (yearFrom(productionDate.start) ??
            yearFrom(productionDate.period))
          : null,
        medium:
          object.techniques && object.techniques.length > 0
            ? clean(object.techniques.join("; "))
            : null,
        dimensions: formatDimensions(object.dimensions),
        credit_line: null,
        image_url: hasOpenImage ? (object.image_thumbnail as string) : null,
        image_license: hasOpenImage
          ? "Statens Museum for Kunst (SMK), public domain"
          : null,
        source_url: clean(object.frontend_url),
        artist_source_id: artistId,
      });
    }

    offset += PAGE_SIZE;
    if (offset >= json.found) break;
    await sleep(args.delayMs);
  }

  const artistRows = [...artists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    name: a.name,
    birth_year: a.birth_year,
    death_year: a.death_year,
    nationality: a.nationality,
    source_url: "https://open.smk.dk",
  }));
  const withImage = artworks.filter((a) => a.image_url != null).length;
  console.log(
    `[ingest:smk] mapped ${artworks.length} artworks ` +
      `(${withImage} with an image), ${artistRows.length} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:smk] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(SMK_INSTITUTION, { onConflict: "source,source_id" })
    .select("id")
    .single();
  if (instError) throw new Error(`upsert institution: ${instError.message}`);
  const institutionId = inst.id as string;

  const upsertedArtists = await chunkedUpsert(
    supabase,
    "artists",
    artistRows as unknown as Record<string, unknown>[],
    "id,source_id",
  );
  const artistIdBySourceId = new Map<string, string>(
    upsertedArtists.map((row) => [row.source_id as string, row.id as string]),
  );
  console.log(`[ingest:smk] upserted ${upsertedArtists.length} artists`);

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
  console.log(`[ingest:smk] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:smk] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:smk] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
