// Ingestion adapter for the Rijksmuseum (Amsterdam).
//
// Source: Rijksmuseum open data API (https://data.rijksmuseum.nl/object-metadata/api/)
// License: CC0 for metadata; images are public domain or CC BY.
// Requires a free API key registered at data.rijksmuseum.nl.
//
// Only works that have an image, a named principal maker, and are marked
// public-domain (copyright = null or empty) are ingested. This mirrors
// what the museum itself has chosen to publish openly.
//
// Upserts key on (source, source_id), so re-running updates rows in place.
//
// Examples:
//   RIJKS_API_KEY=... pnpm ingest:rijks -- --dry-run --limit 10
//   RIJKS_API_KEY=... pnpm ingest:rijks -- --limit 500
//
// Guardrails:
//   --limit <n>     REQUIRED. Hard cap on artworks ingested.
//   --delay-ms <n>  Delay between API calls (default 150).
//   --dry-run       Fetch and map but write nothing.
//   --type <str>    Filter by object type (default: painting; use "all" for no filter).

import { createAdminClient } from "./lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "rijks";
const UPSERT_CHUNK = 500;
const API_BASE = "https://www.rijksmuseum.nl/api/en/collection";
const PAGE_SIZE = 100;

interface Args {
  limit: number;
  delayMs: number;
  dryRun: boolean;
  type: string | null;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let delayMs = 150;
  let dryRun = false;
  let type: string | null = "painting";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg === "--delay-ms") delayMs = Number(argv[++i]);
    else if (arg === "--type") {
      const t = argv[++i];
      type = t === "all" ? null : t;
    } else throw new Error(`Unknown argument: ${arg}`);
  }

  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      "--limit <n> is required (a positive integer).\n" +
        "Example: RIJKS_API_KEY=... pnpm ingest:rijks -- --dry-run --limit 10",
    );
  }
  return {
    limit,
    delayMs: Math.max(0, Math.trunc(delayMs)),
    dryRun,
    type,
  };
}

let delayMs = 150;
async function sleep(): Promise<void> {
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
}

function saneYear(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n < -3000 || n > 2100) return null;
  return n;
}

function parseYear(s: string | null | undefined): number | null {
  if (!s) return null;
  const match = s.match(/-?\d{3,4}/);
  return match ? saneYear(Number(match[0])) : null;
}

interface RijksSummary {
  id: string;
  objectNumber: string;
  title: string;
  principalOrFirstMaker: string;
  hasImage: boolean;
  webImage?: { url: string };
  permitDownload?: boolean;
}

interface RijksMaker {
  id?: string;
  name: string;
  unFixedName?: string;
  placeOfBirth?: string;
  dateOfBirth?: string;
  dateOfDeath?: string;
  gender?: string;
  nationality?: string;
  qualification?: string;
  attributionObsolete?: boolean;
}

interface RijksDetail {
  objectNumber: string;
  title: string;
  titles?: string[];
  principalMakers?: RijksMaker[];
  physicalMedium?: string;
  materials?: string[];
  dimensions?: { unit: string; type: string; value: string }[];
  dating?: {
    presentingDate?: string;
    yearEarly?: number;
    yearLate?: number;
    sortingDate?: number;
  };
  webImage?: { url: string };
  hasImage?: boolean;
  copyrightHolder?: string | null;
  links?: { web?: string };
  longTitle?: string;
}

interface ArtistRow {
  source: string;
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
  image_url: string | null;
  image_license: string;
  source_url: string | null;
  artist_source_id: string;
}

const RIJKS_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:rijks",
  name: "Rijksmuseum",
  type: "art museum",
  city: "Amsterdam",
  country: "Netherlands",
  website: "https://www.rijksmuseum.nl",
  source_url: "https://www.rijksmuseum.nl/en/collection",
};

function artistSourceId(maker: RijksMaker): string {
  if (maker.id) {
    const match = maker.id.match(/\/(\d+)$/);
    if (match) return `maker:${match[1]}`;
  }
  return `name:${maker.name.toLowerCase().trim()}`;
}

function mapArtist(maker: RijksMaker): ArtistRow {
  const name = maker.qualification
    ? `${maker.qualification.replace(/^(\w)/, (c) => c.toUpperCase())} ${maker.name}`
    : maker.name;
  return {
    source: SOURCE,
    source_id: artistSourceId(maker),
    name,
    birth_year: parseYear(maker.dateOfBirth),
    death_year: parseYear(maker.dateOfDeath),
    nationality: maker.nationality ?? null,
  };
}

function formatDimensions(
  dims: { unit: string; type: string; value: string }[],
): string | null {
  if (!dims || dims.length === 0) return null;
  const cm = dims.filter((d) => d.unit === "cm");
  if (cm.length === 0) return null;
  const h = cm.find((d) => d.type === "height");
  const w = cm.find((d) => d.type === "width");
  const d = cm.find((d) => d.type === "depth");
  const parts = [
    h ? `h ${h.value}` : null,
    w ? `w ${w.value}` : null,
    d ? `d ${d.value}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join(" x ")} cm` : null;
}

function imageUrl(detail: RijksDetail): string | null {
  const url = detail.webImage?.url;
  if (!url) return null;
  return url.includes("=") ? url : `${url}=s800`;
}

function mapArtwork(detail: RijksDetail, makerSourceId: string): MappedArtwork {
  const year = saneYear(detail.dating?.sortingDate ?? detail.dating?.yearEarly ?? null);
  return {
    source: SOURCE,
    source_id: detail.objectNumber,
    title:
      detail.title && detail.title.trim() !== "" ? detail.title : "Untitled",
    date_text: detail.dating?.presentingDate ?? null,
    date_year: year,
    medium: detail.physicalMedium ?? null,
    dimensions: detail.dimensions ? formatDimensions(detail.dimensions) : null,
    image_url: imageUrl(detail),
    image_license: "Public Domain (CC0)",
    source_url: detail.links?.web ?? `https://www.rijksmuseum.nl/en/collection/${detail.objectNumber}`,
    artist_source_id: makerSourceId,
  };
}

function isWanted(detail: RijksDetail): boolean {
  if (!detail.hasImage || !detail.webImage?.url) return false;
  if (detail.copyrightHolder) return false;
  const maker = detail.principalMakers?.[0];
  if (!maker || !maker.name || maker.name.trim() === "") return false;
  if (maker.attributionObsolete) return false;
  return true;
}

async function fetchPage(
  apiKey: string,
  page: number,
  type: string | null,
): Promise<{ artObjects: RijksSummary[]; count: number }> {
  const params = new URLSearchParams({
    key: apiKey,
    format: "json",
    ps: String(PAGE_SIZE),
    p: String(page),
    imgonly: "True",
  });
  if (type) params.set("type", type);
  const url = `${API_BASE}?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Collection page ${page}: HTTP ${res.status}`);
  const json = (await res.json()) as {
    artObjects?: RijksSummary[];
    count?: number;
  };
  return {
    artObjects: json.artObjects ?? [],
    count: json.count ?? 0,
  };
}

async function fetchDetail(
  apiKey: string,
  objectNumber: string,
): Promise<RijksDetail | null> {
  const params = new URLSearchParams({ key: apiKey, format: "json" });
  const url = `${API_BASE}/${encodeURIComponent(objectNumber)}?${params}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { artObject?: RijksDetail };
    return json.artObject ?? null;
  } catch {
    return null;
  }
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
  delayMs = args.delayMs;

  const apiKey = process.env.RIJKS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RIJKS_API_KEY environment variable is required.\n" +
        "Register for a free key at https://data.rijksmuseum.nl/object-metadata/api/",
    );
  }

  console.log(
    `[ingest:rijks] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit} ` +
      `type=${args.type ?? "all"} delay=${args.delayMs}ms`,
  );

  const kept: { detail: RijksDetail; makerSourceId: string }[] = [];
  let page = 1;
  let totalObjects = 0;
  let fetched = 0;
  let failed = 0;

  outer: while (kept.length < args.limit) {
    await sleep();
    const { artObjects, count } = await fetchPage(apiKey, page, args.type);
    if (page === 1) totalObjects = count;
    if (artObjects.length === 0) break;

    for (const summary of artObjects) {
      if (kept.length >= args.limit) break outer;
      fetched++;
      await sleep();
      const detail = await fetchDetail(apiKey, summary.objectNumber);
      if (!detail) {
        failed++;
        continue;
      }
      if (!isWanted(detail)) continue;

      const maker = detail.principalMakers![0];
      const sourceId = artistSourceId(maker);
      kept.push({ detail, makerSourceId: sourceId });

      if (fetched % 50 === 0) {
        console.log(
          `[ingest:rijks] fetched ${fetched} objects, kept ${kept.length}/${args.limit}, ` +
            `${failed} failed (page ${page})`,
        );
      }
    }

    page++;
    if (artObjects.length < PAGE_SIZE) break;
  }

  console.log(
    `[ingest:rijks] fetched ${fetched} objects total, kept ${kept.length}, ` +
      `${failed} failed (collection has ~${totalObjects} with images)`,
  );

  const artistsById = new Map<string, ArtistRow>();
  for (const { detail, makerSourceId } of kept) {
    if (!artistsById.has(makerSourceId)) {
      const maker = detail.principalMakers![0];
      artistsById.set(makerSourceId, mapArtist(maker));
    }
  }
  const artistRows = [...artistsById.values()];
  const artworkRows = kept.map(({ detail, makerSourceId }) =>
    mapArtwork(detail, makerSourceId),
  );

  console.log(
    `[ingest:rijks] mapped ${artworkRows.length} artworks, ` +
      `${artistRows.length} artists, 1 institution`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:rijks] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworkRows.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(RIJKS_INSTITUTION, { onConflict: "source,source_id" })
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
  console.log(`[ingest:rijks] upserted ${upsertedArtists.length} artists`);

  const artworkInsertRows = artworkRows.map((artwork) => {
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
  console.log(`[ingest:rijks] upserted ${upsertedArtworks.length} artworks`);
  console.log("[ingest:rijks] done.");
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:rijks] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
