// Ingestion adapter for the Harvard Art Museums.
//
// Fetches objects from the Harvard Art Museums REST API and upserts artworks
// and artists into Supabase. The API requires a free key: register at
// https://harvardartmuseums.org/collections/api and add it to .env.local as
//   HARVARD_API_KEY=your-key
//
// Only images Harvard has cleared for display (imagepermissionlevel 0) are
// stored; other works keep their metadata and link out. Upserts key on
// (source, source_id) with source = 'harvard', so re-running is idempotent.
//
// Examples:
//   pnpm ingest:harvard -- --dry-run --limit 10
//   pnpm ingest:harvard -- --limit 800

import { createAdminClient } from "./lib/supabase-admin";
import { lifeYears } from "./lib/harvard-parsers";
import { yearFromText } from "./lib/year";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "harvard";
const UPSERT_CHUNK = 500;
const API = "https://api.harvardartmuseums.org/object";
const PAGE_SIZE = 100;

// Harvard classification names (plural) we treat as artworks.
const ARTWORK_CLASSES = new Set([
  "paintings",
  "sculpture",
  "drawings",
  "prints",
  "photographs",
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
        "Example: pnpm ingest:harvard -- --dry-run --limit 10",
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
  const key = process.env.HARVARD_API_KEY;
  if (!key) {
    throw new Error(
      "Missing HARVARD_API_KEY.\n" +
        "Get a free key at https://harvardartmuseums.org/collections/api\n" +
        "and add it to .env.local:\n  HARVARD_API_KEY=your-key",
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

// lifeYears now lives in scripts/lib/harvard-parsers.ts so it can be
// unit-tested without importing this adapter file (which runs main() at
// the bottom). See scripts/lib/harvard-parsers.test.ts for 8-case coverage.

interface HarvardPerson {
  role?: string;
  name?: string;
  displayname?: string;
  personid?: number;
  displaydate?: string;
  culture?: string;
  displayorder?: number;
}

interface HarvardObject {
  id: number;
  title?: string;
  dated?: string;
  datebegin?: number;
  medium?: string;
  dimensions?: string;
  creditline?: string;
  classification?: string;
  primaryimageurl?: string | null;
  imagepermissionlevel?: number;
  url?: string;
  people?: HarvardPerson[];
}

interface HarvardResponse {
  info: { page: number; pages: number; totalrecords: number };
  records: HarvardObject[];
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

const HARVARD_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:harvard",
  name: "Harvard Art Museums",
  type: "museum",
  city: "Cambridge",
  country: "United States",
  website: "https://harvardartmuseums.org",
  source_url: "https://harvardartmuseums.org",
};

// The artist of an object: the Artist-role person with the lowest display
// order. Harvard records also list printers, former collectors, and so on.
function primaryArtist(object: HarvardObject): HarvardPerson | null {
  const people = (object.people ?? []).filter(
    (p) => p.role === "Artist" && (p.displayname ?? p.name ?? "").trim() !== "",
  );
  if (people.length === 0) return null;
  people.sort((a, b) => (a.displayorder ?? 999) - (b.displayorder ?? 999));
  return people[0];
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
    `[ingest:harvard] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );
  const apiKey = loadApiKey();

  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, Artist>();
  let page = 1;

  while (artworks.length < args.limit) {
    const url =
      `${API}?apikey=${apiKey}&size=${PAGE_SIZE}&page=${page}` +
      `&fields=id,title,dated,datebegin,medium,dimensions,creditline,` +
      `classification,primaryimageurl,imagepermissionlevel,url,people`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Harvard API ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as HarvardResponse;
    if (!json.records || json.records.length === 0) break;

    for (const object of json.records) {
      if (artworks.length >= args.limit) break;
      if (!ARTWORK_CLASSES.has((object.classification ?? "").toLowerCase())) {
        continue;
      }
      const title = (object.title ?? "").trim();
      if (title === "") continue;

      const person = primaryArtist(object);
      if (!person || person.personid == null) continue;
      const artistId = String(person.personid);
      if (!artists.has(artistId)) {
        const { birth, death } = lifeYears(person.displaydate);
        artists.set(artistId, {
          source_id: artistId,
          name: (person.displayname ?? person.name ?? "").trim(),
          birth_year: birth,
          death_year: death,
          nationality: clean(person.culture),
        });
      }

      // Image-first policy: skip records without an open-access image.
      // Harvard marks cleared images with imagepermissionlevel=0; any other
      // value means the image is rights-restricted or absent.
      const hasOpenImage =
        object.imagepermissionlevel === 0 &&
        typeof object.primaryimageurl === "string" &&
        object.primaryimageurl !== "";
      if (!hasOpenImage) continue;

      artworks.push({
        source: SOURCE,
        source_id: String(object.id),
        title,
        date_text: clean(object.dated),
        date_year:
          (Number.isInteger(object.datebegin) && object.datebegin !== 0
            ? (object.datebegin as number)
            : null) ?? yearFromText(object.dated),
        medium: clean(object.medium),
        dimensions: clean(object.dimensions),
        credit_line: clean(object.creditline),
        image_url: object.primaryimageurl as string,
        image_license: "Harvard Art Museums (see source)",
        source_url: clean(object.url),
        artist_source_id: artistId,
      });
    }

    if (page >= json.info.pages) break;
    page++;
    await sleep(args.delayMs);
  }

  const artistRows = [...artists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    name: a.name,
    birth_year: a.birth_year,
    death_year: a.death_year,
    nationality: a.nationality,
    source_url: `https://harvardartmuseums.org/art/${a.source_id}`,
  }));
  const withImage = artworks.filter((a) => a.image_url != null).length;
  console.log(
    `[ingest:harvard] mapped ${artworks.length} artworks ` +
      `(${withImage} with an image), ${artistRows.length} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:harvard] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(HARVARD_INSTITUTION, { onConflict: "source,source_id" })
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
  console.log(`[ingest:harvard] upserted ${upsertedArtists.length} artists`);

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
  console.log(`[ingest:harvard] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:harvard] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:harvard] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
