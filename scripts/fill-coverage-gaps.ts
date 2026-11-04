// One-shot script that ingests all works by marquee modern/contemporary artists
// missing from Dartabase. Streams the full Tate and Whitney CSVs but only
// upserts rows for the target artist IDs - no arbitrary row limit needed.
//
// Target artists and their IDs in each source:
//   Tate:    Bacon 682, Bourgeois 2351, Freud 1120, Hirst 2308, Hockney 1293,
//            Koons 2368, Kusama 8094, Warhol 2121
//   Whitney: Basquiat 69, Bourgeois 157, Hockney 5274, Kusama 735, Warhol 1384
//
// Usage:
//   pnpm tsx scripts/fill-coverage-gaps.ts [--dry-run]

import { streamCsv } from "./lib/csv-stream";
import { createAdminClient } from "./lib/supabase-admin";
import { yearFromText } from "./lib/year";
import { flipName, rewriteTateImageUrl } from "./lib/tate-parsers";
import type { SupabaseClient } from "@supabase/supabase-js";

const UPSERT_CHUNK = 500;
const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// Tate
// ---------------------------------------------------------------------------

const TATE_RAW =
  "https://raw.githubusercontent.com/tategallery/collection/master/";

const TATE_TARGET_IDS = new Set([
  "682",   // Francis Bacon
  "2351",  // Louise Bourgeois
  "1120",  // Lucian Freud
  "2308",  // Damien Hirst
  "1293",  // David Hockney
  "2368",  // Jeff Koons
  "8094",  // Yayoi Kusama
  "2121",  // Andy Warhol
]);

const TATE_ATTRIBUTION_ROLES: Record<string, string> = {
  after: "After",
  "attributed to": "Attributed to",
  "manner of": "Manner of",
  "pupil of": "Pupil of",
  "formerly attributed to": "Formerly attributed to",
  "studio of": "Studio of",
  "imitator of": "Imitator of",
  "school of": "School of",
  "follower of": "Follower of",
};

function cleanStr(value: string | undefined | null): string | null {
  const s = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (s === "") return null;
  return s.replace(/\s*\n\s*/g, "; ").replace(/[ \t]{2,}/g, " ");
}

interface TateArtist {
  id: string;
  name: string;
  birth_year: number | null;
  death_year: number | null;
  source_url: string | null;
}

async function runTate(supabase: SupabaseClient | null): Promise<void> {
  console.log("\n[gap:tate] loading artist_data.csv...");
  const artistsById = new Map<string, TateArtist>();
  await streamCsv(TATE_RAW + "artist_data.csv", (row) => {
    const id = (row.id ?? "").trim();
    if (!TATE_TARGET_IDS.has(id)) return;
    const raw = (row.name ?? "").trim();
    if (raw === "") return;
    artistsById.set(id, {
      id,
      name: flipName(raw),
      birth_year: row.yearOfBirth ? Number(row.yearOfBirth) || null : null,
      death_year: row.yearOfDeath ? Number(row.yearOfDeath) || null : null,
      source_url: cleanStr(row.url),
    });
  });
  console.log(`[gap:tate] ${artistsById.size} target artists found`);

  console.log("[gap:tate] streaming artwork_data.csv for target artists...");
  type MappedArtwork = {
    source: string; source_id: string; title: string;
    date_text: string | null; date_year: number | null;
    medium: string | null; dimensions: string | null;
    credit_line: string | null; image_url: string | null;
    image_license: string | null; source_url: string | null;
    artist_source_id: string;
  };
  const artworks: MappedArtwork[] = [];
  const seenArtists = new Map<string, TateArtist>();

  await streamCsv(TATE_RAW + "artwork_data.csv", (row) => {
    const accession = (row.accession_number ?? "").trim();
    if (accession === "") return;
    const title = cleanStr(row.title);
    if (!title) return;
    const artistId = (row.artistId ?? "").trim();
    if (!TATE_TARGET_IDS.has(artistId)) return;
    const artist = artistsById.get(artistId);
    if (!artist) return;
    const role = (row.artistRole ?? "").trim().toLowerCase();
    if (role === "and other artists") return;
    const prefix = TATE_ATTRIBUTION_ROLES[role];
    const artistName = prefix ? `${prefix} ${artist.name}` : artist.name;
    const artistKey = prefix ? `${artistId}:${role}` : artistId;
    if (!seenArtists.has(artistKey)) {
      seenArtists.set(artistKey, { ...artist, id: artistKey, name: artistName });
    }
    const rawThumb = (row.thumbnailUrl ?? "").trim();
    const imageUrl = rewriteTateImageUrl(rawThumb);
    const copyright = (row.thumbnailCopyright ?? "").trim();
    artworks.push({
      source: "tate",
      source_id: accession,
      title,
      date_text: cleanStr(row.dateText),
      date_year: yearFromText(row.year),
      medium: cleanStr(row.medium),
      dimensions: cleanStr(row.dimensions),
      credit_line: cleanStr(row.creditLine),
      image_url: imageUrl,
      image_license: copyright !== "" ? copyright : imageUrl ? "Tate" : null,
      source_url: cleanStr(row.url),
      artist_source_id: artistKey,
    });
  });

  console.log(`[gap:tate] ${artworks.length} artworks for ${seenArtists.size} artists`);

  if (DRY_RUN) {
    console.log("[gap:tate] DRY RUN - sample:");
    for (const a of artworks.slice(0, 3)) console.log(" ", a.title, "|", a.artist_source_id);
    return;
  }

  const { data: inst, error: instError } = await supabase!
    .from("institutions")
    .upsert({
      source: "tate", source_id: "institution:tate",
      name: "Tate", type: "museum", city: "London", country: "United Kingdom",
      website: "https://www.tate.org.uk",
      source_url: "https://www.tate.org.uk/art/collection",
    }, { onConflict: "source,source_id" })
    .select("id").single();
  if (instError) throw new Error(`upsert tate institution: ${instError.message}`);
  const institutionId = inst.id as string;

  const artistRows = [...seenArtists.values()].map((a) => ({
    source: "tate", source_id: a.id, name: a.name,
    birth_year: a.birth_year, death_year: a.death_year,
    nationality: null, source_url: a.source_url,
  }));
  const upsertedArtists = await chunkedUpsert(supabase!, "artists", artistRows as Record<string, unknown>[], "id,source_id");
  const artistIdByKey = new Map<string, string>(
    upsertedArtists.map((r) => [r.source_id as string, r.id as string]),
  );
  console.log(`[gap:tate] upserted ${upsertedArtists.length} artists`);

  const artworkRows = artworks.map(({ artist_source_id, ...rest }) => ({
    ...rest,
    artist_id: artistIdByKey.get(artist_source_id) ?? null,
    current_institution_id: institutionId,
  }));
  const upserted = await chunkedUpsert(supabase!, "artworks", artworkRows as Record<string, unknown>[], "id");
  console.log(`[gap:tate] upserted ${upserted.length} artworks`);
}

// ---------------------------------------------------------------------------
// Whitney
// ---------------------------------------------------------------------------

const WHITNEY_RAW =
  "https://raw.githubusercontent.com/whitneymuseum/open-access/master/";

const WHITNEY_TARGET_IDS = new Set([
  "69",    // Jean-Michel Basquiat
  "157",   // Louise Bourgeois
  "5274",  // David Hockney
  "735",   // Yayoi Kusama
  "1384",  // Andy Warhol
]);

function yearOrNull(value: string | undefined | null): number | null {
  const v = (value ?? "").trim();
  if (v === "" || v === "0") return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

interface WhitneyArtist {
  id: string;
  wikidata_id: string | null;
  display_name: string;
  birth_year: number | null;
  death_year: number | null;
}

async function runWhitney(supabase: SupabaseClient | null): Promise<void> {
  console.log("\n[gap:whitney] loading artists.csv...");
  const artistsById = new Map<string, WhitneyArtist>();
  await streamCsv(WHITNEY_RAW + "artists.csv", (row) => {
    const id = (row.id ?? "").trim();
    if (!WHITNEY_TARGET_IDS.has(id)) return;
    const name = (row.display_name ?? "").trim();
    if (name === "") return;
    const wikidata = (row.wikidata_id ?? "").trim();
    artistsById.set(id, {
      id,
      wikidata_id: wikidata === "" ? null : wikidata,
      display_name: name,
      birth_year: yearOrNull(row.begin_date),
      death_year: yearOrNull(row.end_date),
    });
  });
  console.log(`[gap:whitney] ${artistsById.size} target artists found`);

  console.log("[gap:whitney] streaming artworks.csv for target artists...");
  type MappedArtwork = {
    source: string; source_id: string; title: string;
    date_text: string | null; date_year: number | null;
    medium: string | null; dimensions: string | null;
    credit_line: string | null; image_url: null; image_license: null;
    source_url: string | null; artist_source_id: string;
  };
  const artworks: MappedArtwork[] = [];
  const seenArtists = new Map<string, WhitneyArtist>();

  await streamCsv(WHITNEY_RAW + "artworks.csv", (row) => {
    const accession = (row.accession_number ?? "").trim();
    if (accession === "") return;
    const title = cleanStr(row.title);
    if (!title) return;
    const rawIds = (row.artist_ids ?? "").trim();
    if (rawIds === "") return;
    const firstId = rawIds.split(/[|,]/)[0]?.trim() ?? "";
    if (!WHITNEY_TARGET_IDS.has(firstId)) return;
    const artist = artistsById.get(firstId);
    if (!artist) return;
    if (!seenArtists.has(firstId)) seenArtists.set(firstId, artist);
    artworks.push({
      source: "whitney",
      source_id: accession,
      title,
      date_text: cleanStr(row.display_date),
      date_year: yearFromText(row.display_date),
      medium: cleanStr(row.medium),
      dimensions: cleanStr(row.dimensions),
      credit_line: cleanStr(row.credit_line),
      image_url: null,
      image_license: null,
      source_url: `https://whitney.org/collection/works/${(row.id ?? "").trim()}`,
      artist_source_id: firstId,
    });
  });

  console.log(`[gap:whitney] ${artworks.length} artworks for ${seenArtists.size} artists`);

  if (DRY_RUN) {
    console.log("[gap:whitney] DRY RUN - sample:");
    for (const a of artworks.slice(0, 3)) console.log(" ", a.title, "|", a.artist_source_id);
    return;
  }

  const { data: inst, error: instError } = await supabase!
    .from("institutions")
    .upsert({
      source: "whitney", source_id: "institution:whitney",
      name: "Whitney Museum of American Art", type: "museum",
      city: "New York", country: "United States",
      website: "https://whitney.org", source_url: "https://whitney.org/collection",
    }, { onConflict: "source,source_id" })
    .select("id").single();
  if (instError) throw new Error(`upsert whitney institution: ${instError.message}`);
  const institutionId = inst.id as string;

  const artistRows = [...seenArtists.values()].map((a) => ({
    source: "whitney", source_id: a.id, name: a.display_name,
    birth_year: a.birth_year, death_year: a.death_year,
    nationality: null,
    source_url: `https://whitney.org/artists/${a.id}`,
    wikidata_id: a.wikidata_id,
  }));
  const upsertedArtists = await chunkedUpsert(supabase!, "artists", artistRows as Record<string, unknown>[], "id,source_id");
  const artistIdByKey = new Map<string, string>(
    upsertedArtists.map((r) => [r.source_id as string, r.id as string]),
  );
  console.log(`[gap:whitney] upserted ${upsertedArtists.length} artists`);

  const artworkRows = artworks.map(({ artist_source_id, ...rest }) => ({
    ...rest,
    artist_id: artistIdByKey.get(artist_source_id) ?? null,
    current_institution_id: institutionId,
  }));
  const upserted = await chunkedUpsert(supabase!, "artworks", artworkRows as Record<string, unknown>[], "id");
  console.log(`[gap:whitney] upserted ${upserted.length} artworks`);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[gap] Coverage gap fill - ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  const supabase = DRY_RUN ? null : createAdminClient();
  await runTate(supabase);
  await runWhitney(supabase);
  if (!DRY_RUN) {
    console.log("\n[gap] Done. Run `pnpm dedup` to fold cross-source duplicates.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
