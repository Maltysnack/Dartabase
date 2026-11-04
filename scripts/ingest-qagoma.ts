// Ingestion adapter for QAGOMA, the Queensland Art Gallery and Gallery of
// Modern Art. Reads the gallery's open-data CSV from the Queensland Government
// open data portal.
//
// The CSV carries metadata only (no images), so QAGOMA artworks are
// metadata-only records that link out to QAGOMA.
//
// ICIP: records in QAGOMA's "Indigenous Australian Art" department are flagged
// with cultural_notice so the site shows a content advisory. We mirror only
// what QAGOMA has itself published. See the ICIP section of CLAUDE.md.
//
// Examples:
//   pnpm ingest:qagoma -- --dry-run --limit 20
//   pnpm ingest:qagoma -- --limit 3000

import { parse } from "csv-parse/sync";
import { createAdminClient } from "./lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "qagoma";
const UPSERT_CHUNK = 500;

// QAGOMA's current open-data release (refreshed periodically by QAGOMA).
const CSV_URL =
  "https://www.data.qld.gov.au/dataset/31cb168e-4d6e-4ef6-881c-bc5f0bd8b97f/resource/9fd5697c-8e26-44f6-b8ad-2fef67615253/download/qagoma-collection-artworks-december-2024.csv";

const INDIGENOUS_DEPARTMENT = "Indigenous Australian Art";

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
        "Example: pnpm ingest:qagoma -- --dry-run --limit 20",
    );
  }
  return { limit, dryRun };
}

interface QagomaRow {
  irn: string;
  Title: string;
  Person: string;
  DateCreated: string;
  PhyMediumText: string;
  PhysicalDimensions: string;
  CreditLine: string;
  Department: string;
  CollectionOnlineAPI: string;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

// QAGOMA's Person field looks like "KAPOOR, Anish - Creator" (surname upper).
function parsePerson(
  raw: string,
): { name: string; sortName: string | null } | null {
  let value = (raw ?? "").split(";")[0].trim();
  const dash = value.lastIndexOf(" - ");
  if (dash !== -1) value = value.slice(0, dash).trim();
  if (value === "") return null;
  const comma = value.indexOf(", ");
  if (comma === -1) return { name: value, sortName: null };
  const last = titleCase(value.slice(0, comma).trim());
  const given = value.slice(comma + 2).trim();
  if (given === "") return { name: last, sortName: null };
  return { name: `${given} ${last}`, sortName: `${last}, ${given}` };
}

function parseYear(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\b(\d{4})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1 && year <= new Date().getFullYear() ? year : null;
}

interface ArtistRow {
  source: string;
  source_id: string;
  name: string;
  sort_name: string | null;
  nationality: string | null;
  source_url: string;
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
  source_url: string | null;
  cultural_notice: boolean;
  artist_source_id: string;
}

const QAGOMA_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:qagoma",
  name: "Queensland Art Gallery and Gallery of Modern Art",
  type: "gallery",
  city: "Brisbane",
  country: "Australia",
  website: "https://www.qagoma.qld.gov.au",
  source_url: "https://www.qagoma.qld.gov.au",
};

function artistKey(name: string): string {
  return `name:${name.toLowerCase().trim()}`;
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
    `[ingest:qagoma] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  console.log("[ingest:qagoma] downloading open-data CSV...");
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    throw new Error(`CSV download ${res.status} ${res.statusText}`);
  }
  const csv = await res.text();
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  }) as QagomaRow[];
  console.log(`[ingest:qagoma] CSV has ${records.length} rows`);

  const artistsBySourceId = new Map<string, ArtistRow>();
  const artworkRows: MappedArtwork[] = [];
  let indigenousCount = 0;

  for (const row of records) {
    if (artworkRows.length >= args.limit) break;
    const title = (row.Title ?? "").trim();
    const person = parsePerson(row.Person ?? "");
    const irn = (row.irn ?? "").trim();
    if (title === "" || person === null || irn === "") continue;

    const department = (row.Department ?? "").trim();
    const isAustralian = department.includes("Australian");
    const culturalNotice = department === INDIGENOUS_DEPARTMENT;
    if (culturalNotice) indigenousCount++;

    const sourceId = artistKey(person.name);
    if (!artistsBySourceId.has(sourceId)) {
      artistsBySourceId.set(sourceId, {
        source: SOURCE,
        source_id: sourceId,
        name: person.name,
        sort_name: person.sortName,
        nationality: isAustralian ? "Australian" : null,
        source_url: "https://www.qagoma.qld.gov.au",
      });
    }

    const onlineApi = (row.CollectionOnlineAPI ?? "").trim();
    artworkRows.push({
      source: SOURCE,
      source_id: irn,
      title,
      date_text: (row.DateCreated ?? "").trim() || null,
      date_year: parseYear(row.DateCreated),
      medium: (row.PhyMediumText ?? "").trim() || null,
      dimensions: (row.PhysicalDimensions ?? "").trim() || null,
      credit_line: (row.CreditLine ?? "").trim() || null,
      source_url: onlineApi
        ? onlineApi.replace("/api/objects/", "/objects/")
        : null,
      cultural_notice: culturalNotice,
      artist_source_id: sourceId,
    });
  }

  const artistRows = [...artistsBySourceId.values()];
  console.log(
    `[ingest:qagoma] mapped ${artworkRows.length} artworks, ` +
      `${artistRows.length} artists, ${indigenousCount} flagged ` +
      `(Indigenous Australian Art)`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:qagoma] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworkRows.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(QAGOMA_INSTITUTION, { onConflict: "source,source_id" })
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
  console.log(`[ingest:qagoma] upserted ${upsertedArtists.length} artists`);

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
  console.log(`[ingest:qagoma] upserted ${upsertedArtworks.length} artworks`);
  console.log("[ingest:qagoma] done.");
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:qagoma] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
