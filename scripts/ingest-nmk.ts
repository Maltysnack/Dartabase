// Ingestion adapter for Nasjonalmuseet (National Museum of Norway), art
// collection (NMK-B).
//
// Fetches public-domain, image-bearing works from the DigitaltMuseum API
// (api.dimu.org) and upserts artworks and artists into Supabase. The API
// uses a demo key; no registration is required. Only works with license
// "None None" (public domain) and pictures are mirrored.
// Upserts key on (source, source_id) with source = 'nmk', so re-running
// is idempotent.
//
// Examples:
//   pnpm ingest:nmk -- --dry-run --limit 10
//   pnpm ingest:nmk -- --limit 2000

import { createAdminClient } from "./lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "nmk";
const UPSERT_CHUNK = 500;
const PAGE_SIZE = 10;

// Norwegian medium names -> English
const MEDIUM_MAP: Record<string, string> = {
  Maleri: "oil on canvas",
  Tegning: "drawing",
  Grafikk: "print",
  Fotografi: "photograph",
  FOTO: "photograph",
  Opplagstrykk: "print",
  Illustrasjon: "illustration",
  Skulptur: "sculpture",
  Relieff: "relief",
  Byste: "bust",
  Statuett: "figurine",
  Statue: "sculpture",
  Skissebok: "sketchbook",
  "Ukiyo-e": "woodblock print",
  Gruppe: "sculpture group",
  Portrett: "portrait",
  Herme: "herm",
  Ikon: "icon",
};

interface Args {
  limit: number;
  delayMs: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let delayMs = 150;
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
        "Example: pnpm ingest:nmk -- --dry-run --limit 10",
    );
  }
  return { limit, delayMs, dryRun };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface DimuDoc {
  "identifier.id": string;
  "artifact.uniqueId": string;
  "artifact.uuid": string;
  "artifact.ingress.title": string;
  "artifact.ingress.producer"?: string;
  "artifact.ingress.producerRole"?: string;
  "artifact.ingress.production.fromYear"?: number;
  "artifact.ingress.production.toYear"?: number;
  "artifact.defaultMediaIdentifier"?: string;
  "artifact.ingress.license"?: string[];
  "artifact.ingress.names"?: string[];
}

interface DimuResponse {
  response: {
    numFound: number;
    start: number;
    docs: DimuDoc[];
  };
}

interface Artist {
  source_id: string;
  name: string;
  sort_name: string;
}

interface MappedArtwork {
  source: string;
  source_id: string;
  title: string;
  date_text: string | null;
  date_year: number | null;
  medium: string | null;
  image_url: string | null;
  image_license: string | null;
  source_url: string | null;
  artist_source_id: string | null;
}

const NMK_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:nmk",
  name: "Nasjonalmuseet (National Museum of Norway)",
  type: "museum",
  city: "Oslo",
  country: "Norway",
  website: "https://www.nasjonalmuseet.no",
  source_url: "https://www.nasjonalmuseet.no",
};

// "Lastname, Firstname" -> "Firstname Lastname"
function displayName(sortForm: string): string {
  const comma = sortForm.indexOf(",");
  if (comma === -1) return sortForm.trim();
  const last = sortForm.slice(0, comma).trim();
  const first = sortForm.slice(comma + 1).trim();
  return first ? `${first} ${last}` : last;
}

// Strip Norwegian medium type from title: "Title [Maleri]" -> "Title"
function cleanTitle(raw: string): string {
  return raw.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
}

function mediumFromNames(names: string[] | undefined): string | null {
  if (!names || names.length === 0) return null;
  for (const n of names) {
    const mapped = MEDIUM_MAP[n];
    if (mapped) return mapped;
  }
  // Fall back to original if it looks like a known art type
  return null;
}

function imageUrl(mediaId: string | undefined): string | null {
  if (!mediaId) return null;
  return `https://dms01.dimu.org/image/${mediaId}?dimension=800x800`;
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

const SOLR_BASE = "https://api.dimu.org/api/solr/select";
const FIELDS = [
  "identifier.id",
  "artifact.uniqueId",
  "artifact.uuid",
  "artifact.ingress.title",
  "artifact.ingress.producer",
  "artifact.ingress.producerRole",
  "artifact.ingress.production.fromYear",
  "artifact.ingress.production.toYear",
  "artifact.defaultMediaIdentifier",
  "artifact.ingress.license",
  "artifact.ingress.names",
].join(",");

const FILTERS = [
  "identifier.owner:NMK-B",
  "artifact.type:Fineart",
  'artifact.ingress.license:"None None"',
  "artifact.hasPictures:true",
].map((f) => `fq=${encodeURIComponent(f)}`).join("&");

async function fetchPage(start: number): Promise<DimuResponse> {
  const url =
    `${SOLR_BASE}?wt=json&q=*:*&${FILTERS}` +
    `&rows=${PAGE_SIZE}&start=${start}&api.key=demo&fl=${encodeURIComponent(FIELDS)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DiMU API ${res.status} at start=${start}`);
  return (await res.json()) as DimuResponse;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[ingest:nmk] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  let artworks: MappedArtwork[] = [];
  const artists = new Map<string, Artist>();
  let start = 0;
  let total: number | null = null;

  while (artworks.length < args.limit) {
    const json = await fetchPage(start);
    total ??= json.response.numFound;

    if (json.response.docs.length === 0) break;

    for (const doc of json.response.docs) {
      if (artworks.length >= args.limit) break;

      const rawTitle = doc["artifact.ingress.title"];
      if (!rawTitle) continue;
      const title = cleanTitle(rawTitle);
      if (!title) continue;

      const uniqueId = doc["artifact.uniqueId"];
      if (!uniqueId) continue;

      const producerRaw = doc["artifact.ingress.producer"];
      const producerRole = doc["artifact.ingress.producerRole"];
      const isArtist = !producerRole || producerRole === "Kunstner";

      let artistSourceId: string | null = null;
      if (producerRaw && isArtist) {
        artistSourceId = producerRaw;
        if (!artists.has(producerRaw)) {
          artists.set(producerRaw, {
            source_id: producerRaw,
            name: displayName(producerRaw),
            sort_name: producerRaw,
          });
        }
      }

      const fromYear = doc["artifact.ingress.production.fromYear"];
      const toYear = doc["artifact.ingress.production.toYear"];
      let dateText: string | null = null;
      const dateYear: number | null = fromYear ?? null;
      if (fromYear && toYear && fromYear !== toYear) {
        dateText = `${fromYear}-${toYear}`;
      } else if (fromYear) {
        dateText = String(fromYear);
      }

      const mediaId = doc["artifact.defaultMediaIdentifier"];

      artworks.push({
        source: SOURCE,
        source_id: uniqueId,
        title,
        date_text: dateText,
        date_year: dateYear,
        medium: mediumFromNames(doc["artifact.ingress.names"]),
        image_url: imageUrl(mediaId),
        image_license: mediaId
          ? "Nasjonalmuseet / CC BY-NC"
          : null,
        source_url: `https://digitaltmuseum.org/${uniqueId}`,
        artist_source_id: artistSourceId,
      });
    }

    start += PAGE_SIZE;
    if (total !== null && start >= total) break;
    await sleep(args.delayMs);
  }

  // The source feed can return the same object across pages; collapse to one
  // row per source_id so an upsert chunk never references the same conflict key
  // twice (Postgres: "ON CONFLICT DO UPDATE cannot affect row a second time").
  {
    const seen = new Set<string>();
    artworks = artworks.filter((a) => {
      if (seen.has(a.source_id)) return false;
      seen.add(a.source_id);
      return true;
    });
  }

  const artistRows = [...artists.values()].map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    name: a.name,
    sort_name: a.sort_name,
    source_url: "https://www.nasjonalmuseet.no",
  }));

  const withImage = artworks.filter((a) => a.image_url != null).length;
  console.log(
    `[ingest:nmk] mapped ${artworks.length} artworks ` +
      `(${withImage} with an image), ${artistRows.length} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:nmk] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    console.log("\nSample artists:");
    for (const a of artistRows.slice(0, 3)) {
      console.log(JSON.stringify(a, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(NMK_INSTITUTION, { onConflict: "source,source_id" })
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
  console.log(`[ingest:nmk] upserted ${upsertedArtists.length} artists`);

  const artworkInsertRows = artworks.map((artwork) => {
    const { artist_source_id, ...rest } = artwork;
    return {
      ...rest,
      artist_id: artist_source_id
        ? (artistIdBySourceId.get(artist_source_id) ?? null)
        : null,
      current_institution_id: institutionId,
    };
  });
  const upsertedArtworks = await chunkedUpsert(
    supabase,
    "artworks",
    artworkInsertRows as unknown as Record<string, unknown>[],
    "id",
  );
  console.log(`[ingest:nmk] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:nmk] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:nmk] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
