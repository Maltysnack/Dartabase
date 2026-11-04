// Ingestion adapter for Nationalmuseum Sweden (Nationalmuseum Stockholm).
//
// Queries the public Wikidata SPARQL endpoint for artworks in the Nationalmuseum
// collection (P195 = Q842858) that have images. No API key required.
//
// Wikidata holds ~14,000 works from this collection, largely paintings, with
// high-resolution public domain images via Wikimedia Commons. Data was imported
// to Wikidata by Nationalmuseum staff; see github.com/NationalmuseumSWE/WikidataCollection.
//
// Upserts key on (source, source_id) with source = 'nmse'. Re-running is safe.
//
// Examples:
//   pnpm ingest:nmse -- --dry-run --limit 50
//   pnpm ingest:nmse -- --limit 5000

import { createAdminClient } from "./lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "nmse";
const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "Dartabase/0.1 (art reference aggregator; +https://github.com/Maltysnack/Dartabase)";
const UPSERT_CHUNK = 500;
const QID_RE = /^Q\d+$/;

// Nationalmuseum Stockholm Wikidata item.
const INSTITUTION = {
  source: SOURCE,
  source_id: "Q842858",
  name: "Nationalmuseum",
  type: "museum",
  city: "Stockholm",
  country: "Sweden",
  website: "https://www.nationalmuseum.se",
  source_url: "https://www.nationalmuseum.se",
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
        "Example: pnpm ingest:nmse -- --dry-run --limit 50",
    );
  }
  return { limit, dryRun };
}

interface Binding {
  [key: string]: { value: string } | undefined;
}

function buildQuery(offset: number, pageSize: number): string {
  return `
SELECT ?artwork ?artworkLabel ?creator ?creatorLabel ?inception ?image
       ?birth ?death WHERE {
  VALUES ?type {
    wd:Q3305213 wd:Q860861 wd:Q11060274 wd:Q93184 wd:Q125191 wd:Q838948
  }
  ?artwork wdt:P31 ?type ;
           wdt:P195 wd:Q842858 ;
           wdt:P18 ?image .
  OPTIONAL {
    ?artwork wdt:P170 ?creator .
    ?creator wdt:P31 wd:Q5 .
    OPTIONAL { ?creator wdt:P569 ?birth . }
    OPTIONAL { ?creator wdt:P570 ?death . }
  }
  OPTIONAL { ?artwork wdt:P571 ?inception . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,sv". }
}
ORDER BY ?artwork
LIMIT ${pageSize}
OFFSET ${offset}`;
}

async function runSparql(query: string): Promise<Binding[]> {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/sparql-results+json",
    },
  });
  if (!res.ok) throw new Error(`Wikidata SPARQL ${res.status}: ${res.statusText}`);
  const json = (await res.json()) as { results: { bindings: Binding[] } };
  return json.results.bindings;
}

function qid(entityUrl: string): string {
  return entityUrl.split("/").pop() ?? entityUrl;
}

function yearOf(isoDate: string | undefined): number | null {
  if (!isoDate) return null;
  const m = isoDate.match(/^-?(\d{4})/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function imageUrl(rawUrl: string): string {
  const https = rawUrl.replace(/^http:/, "https:");
  return `${https}${https.includes("?") ? "&" : "?"}width=800`;
}

interface ArtistRow {
  source_id: string;
  name: string;
  birth_year: number | null;
  death_year: number | null;
}

interface ArtworkRow {
  source_id: string;
  title: string;
  date_text: string | null;
  date_year: number | null;
  image_url: string;
  source_url: string;
  artist_source_id: string | null;
}

function processBindings(bindings: Binding[]): {
  artists: Map<string, ArtistRow>;
  artworks: Map<string, ArtworkRow>;
} {
  const artists = new Map<string, ArtistRow>();
  const artworks = new Map<string, ArtworkRow>();

  for (const row of bindings) {
    const artworkUrl = row.artwork?.value;
    const image = row.image?.value;
    if (!artworkUrl || !image) continue;

    const artworkId = qid(artworkUrl);
    const title = row.artworkLabel?.value ?? "";
    if (!title || QID_RE.test(title)) continue;
    if (artworks.has(artworkId)) continue;

    const creatorUrl = row.creator?.value;
    let artistSourceId: string | null = null;

    if (creatorUrl) {
      const creatorId = qid(creatorUrl);
      const creatorName = row.creatorLabel?.value ?? "";
      if (creatorName && !QID_RE.test(creatorName)) {
        artistSourceId = creatorId;
        if (!artists.has(creatorId)) {
          artists.set(creatorId, {
            source_id: creatorId,
            name: creatorName,
            birth_year: yearOf(row.birth?.value),
            death_year: yearOf(row.death?.value),
          });
        }
      }
    }

    const year = yearOf(row.inception?.value);
    artworks.set(artworkId, {
      source_id: artworkId,
      title,
      date_text: year != null ? String(year) : null,
      date_year: year,
      image_url: imageUrl(image),
      source_url: `https://www.wikidata.org/wiki/${artworkId}`,
      artist_source_id: artistSourceId,
    });
  }

  return { artists, artworks };
}

async function chunkedUpsert(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { data, error } = await supabase
      .from(table)
      .upsert(chunk, { onConflict: "source,source_id" })
      .select("id,source_id");
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
    out.push(...((data ?? []) as Record<string, unknown>[]));
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[ingest:nmse] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  // Fetch all results paginated (Wikidata returns max 10000 per query).
  const PAGE_SIZE = 5000;
  const allArtists = new Map<string, ArtistRow>();
  const allArtworks = new Map<string, ArtworkRow>();
  let offset = 0;

  while (allArtworks.size < args.limit) {
    const remaining = args.limit - allArtworks.size;
    const pageSize = Math.min(PAGE_SIZE, remaining);
    process.stdout.write(`  fetching offset=${offset}... `);

    const bindings = await runSparql(buildQuery(offset, pageSize));
    if (bindings.length === 0) break;

    const { artists, artworks } = processBindings(bindings);
    for (const [k, v] of artists) if (!allArtists.has(k)) allArtists.set(k, v);
    for (const [k, v] of artworks) if (!allArtworks.has(k)) allArtworks.set(k, v);

    console.log(`${bindings.length} rows -> ${artworks.size} artworks (${artists.size} artists)`);
    offset += bindings.length;

    if (bindings.length < pageSize) break;
    // Polite delay between SPARQL pages.
    await new Promise((r) => setTimeout(r, 1000));
  }

  const artworkList = [...allArtworks.values()].slice(0, args.limit);
  const artistsNeeded = new Set(artworkList.map((a) => a.artist_source_id).filter(Boolean));
  const artistList = [...allArtists.values()].filter((a) =>
    artistsNeeded.has(a.source_id),
  );

  console.log(
    `[ingest:nmse] mapped ${artworkList.length} artworks, ` +
      `${artistList.length} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:nmse] DRY RUN -- sample of 3 artworks:\n");
    for (const sample of artworkList.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  // Upsert institution.
  const { data: inst, error: instErr } = await supabase
    .from("institutions")
    .upsert(INSTITUTION, { onConflict: "source,source_id" })
    .select("id")
    .single();
  if (instErr) throw new Error(`upsert institution: ${instErr.message}`);
  const institutionId = inst.id as string;

  // Upsert artists.
  const artistRows = artistList.map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    name: a.name,
    birth_year: a.birth_year,
    death_year: a.death_year,
    nationality: null,
    source_url: `https://www.wikidata.org/wiki/${a.source_id}`,
  }));
  const upsertedArtists = await chunkedUpsert(
    supabase,
    "artists",
    artistRows as Record<string, unknown>[],
  );
  const artistIdMap = new Map<string, string>(
    upsertedArtists.map((r) => [r.source_id as string, r.id as string]),
  );
  console.log(`[ingest:nmse] upserted ${upsertedArtists.length} artists`);

  // Upsert artworks.
  const artworkRows = artworkList.map((a) => ({
    source: SOURCE,
    source_id: a.source_id,
    title: a.title,
    date_text: a.date_text,
    date_year: a.date_year,
    medium: null,
    dimensions: null,
    credit_line: null,
    image_url: a.image_url,
    image_license: "Wikidata / Wikimedia Commons, public domain",
    source_url: a.source_url,
    artist_id: a.artist_source_id ? (artistIdMap.get(a.artist_source_id) ?? null) : null,
    current_institution_id: institutionId,
  }));
  const upsertedArtworks = await chunkedUpsert(
    supabase,
    "artworks",
    artworkRows as Record<string, unknown>[],
  );
  console.log(`[ingest:nmse] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:nmse] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:nmse] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
