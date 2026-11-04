// Ingestion adapter for Wikidata: Australian artists and their artworks.
//
// Queries the public Wikidata SPARQL endpoint (no key required) for works of
// art whose creator is an Australian person, and maps them into our schema.
//
// ICIP note: this query will return First Nations artists and artworks. We only
// take what Wikidata has already published, never more, and the site carries a
// standing cultural advisory. See CLAUDE.md and GitHub issue #11.
//
// Modes:
//   --dry-run          Fetch and map, print a summary, write nothing.
//   --emit-sql <path>  Fetch and map, then write an idempotent .sql seed file.
//
// Guardrail: --limit caps the number of SPARQL result rows. Upserts key on
// (source, source_id) with source = 'wikidata', so re-running is safe.
//
// Examples:
//   pnpm ingest:wikidata -- --dry-run --limit 200
//   pnpm ingest:wikidata -- --emit-sql /tmp/wd.sql --limit 250

import { writeFileSync } from "node:fs";

const SOURCE = "wikidata";
const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "Dartabase/0.1 (art reference aggregator; +https://github.com/Maltysnack/Dartabase)";
const QID_RE = /^Q\d+$/;

interface Args {
  limit: number;
  dryRun: boolean;
  emitSql: string | null;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let dryRun = false;
  let emitSql: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--emit-sql") emitSql = argv[++i] ?? null;
    else if (arg === "--limit") limit = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      "--limit <n> is required (a positive integer).\n" +
        "Example: pnpm ingest:wikidata -- --dry-run --limit 200",
    );
  }
  if (!dryRun && emitSql === null) {
    throw new Error("Pass --dry-run or --emit-sql <path>.");
  }
  return { limit, dryRun, emitSql };
}

// Works of art (painting, sculpture, print, drawing, photograph, work of art)
// whose creator is an Australian human, that have an image.
function sparql(limit: number): string {
  // P131 (located in administrative territorial entity) usually returns the
  // immediate municipality; P276 (location) is a softer fallback some items
  // use instead. COALESCE picks the first non-null so each row has at most
  // one ?city, and SERVICE wikibase:label resolves ?cityLabel automatically.
  return `
SELECT ?artwork ?artworkLabel ?creator ?creatorLabel ?inception ?image
       ?collection ?collectionLabel ?website ?city ?cityLabel
       ?birth ?death WHERE {
  VALUES ?type { wd:Q3305213 wd:Q860861 wd:Q11060274 wd:Q93184 wd:Q125191 wd:Q838948 }
  ?artwork wdt:P31 ?type ;
           wdt:P170 ?creator ;
           wdt:P18 ?image .
  ?creator wdt:P31 wd:Q5 ;
           wdt:P27 wd:Q408 .
  OPTIONAL { ?artwork wdt:P571 ?inception . }
  # Pull P195 only when it points at a non-human entity. Wikidata uses P195
  # ("collection") for both holding institutions and notable private
  # collectors (e.g. Q1226322 Walter Baldwin Spencer was attached to one
  # work — see #62/#64). FILTER NOT EXISTS keeps the OPTIONAL itself
  # ungated, so the artwork row still emits with ?collection unbound when
  # the collection turns out to be a person.
  OPTIONAL {
    ?artwork wdt:P195 ?collection .
    FILTER NOT EXISTS { ?collection wdt:P31 wd:Q5 . }
    OPTIONAL { ?collection wdt:P856 ?website . }
    OPTIONAL { ?collection wdt:P131 ?cityP131 . }
    OPTIONAL { ?collection wdt:P276 ?cityP276 . }
    BIND(COALESCE(?cityP131, ?cityP276) AS ?city)
  }
  OPTIONAL { ?creator wdt:P569 ?birth . }
  OPTIONAL { ?creator wdt:P570 ?death . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${limit}`;
}

interface Binding {
  [key: string]: { value: string } | undefined;
}

async function runSparql(query: string): Promise<Binding[]> {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/sparql-results+json",
    },
  });
  if (!res.ok) {
    throw new Error(`Wikidata SPARQL ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { results: { bindings: Binding[] } };
  return json.results.bindings;
}

function qid(entityUrl: string): string {
  return entityUrl.split("/").pop() ?? entityUrl;
}

function yearOf(isoDate: string | undefined): number | null {
  if (!isoDate) return null;
  const match = isoDate.match(/^(-?\d+)/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

// Special:FilePath URLs serve the file directly; request a display-sized copy.
function imageUrl(rawUrl: string): string {
  const https = rawUrl.replace(/^http:/, "https:");
  return `${https}${https.includes("?") ? "&" : "?"}width=800`;
}

interface InstitutionRow {
  source_id: string;
  name: string;
  website: string | null;
  city: string | null;
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
  artist_source_id: string;
  institution_source_id: string | null;
}

interface Mapped {
  institutions: InstitutionRow[];
  artists: ArtistRow[];
  artworks: ArtworkRow[];
}

function mapBindings(bindings: Binding[]): Mapped {
  const institutions = new Map<string, InstitutionRow>();
  const artists = new Map<string, ArtistRow>();
  const artworks = new Map<string, ArtworkRow>();

  for (const row of bindings) {
    const artworkUrl = row.artwork?.value;
    const creatorUrl = row.creator?.value;
    const image = row.image?.value;
    if (!artworkUrl || !creatorUrl || !image) continue;

    const artworkId = qid(artworkUrl);
    const creatorId = qid(creatorUrl);
    const title = row.artworkLabel?.value ?? "";
    const creatorName = row.creatorLabel?.value ?? "";

    // Skip records with no real label (Wikidata returns the QID as the label).
    if (title === "" || QID_RE.test(title)) continue;
    if (creatorName === "" || QID_RE.test(creatorName)) continue;
    if (artworks.has(artworkId)) continue;

    if (!artists.has(creatorId)) {
      artists.set(creatorId, {
        source_id: creatorId,
        name: creatorName,
        birth_year: yearOf(row.birth?.value),
        death_year: yearOf(row.death?.value),
      });
    }

    let institutionSourceId: string | null = null;
    const collectionUrl = row.collection?.value;
    const collectionName = row.collectionLabel?.value;
    if (collectionUrl && collectionName) {
      const collectionId = qid(collectionUrl);
      // Skip Wikidata blank nodes (".well-known/genid/..."), whose id is not a
      // real QID and whose label is a bare URL.
      const realItem = QID_RE.test(collectionId);
      const cleanName =
        !QID_RE.test(collectionName) && !collectionName.startsWith("http");
      if (realItem && cleanName) {
        institutionSourceId = collectionId;
        // Wikidata's SERVICE wikibase:label falls back to the QID when no
        // English label exists; treat that as null rather than save a "Q123"
        // string into the city column.
        const rawCity = row.cityLabel?.value;
        const city =
          rawCity && !QID_RE.test(rawCity) && !rawCity.startsWith("http")
            ? rawCity
            : null;
        if (!institutions.has(institutionSourceId)) {
          institutions.set(institutionSourceId, {
            source_id: collectionId,
            name: collectionName,
            website: row.website?.value ?? null,
            city,
          });
        } else if (city) {
          // First-write-wins is fine, but if the row we kept had no city and
          // a later row supplies one, prefer the populated value.
          const existing = institutions.get(institutionSourceId)!;
          if (!existing.city) existing.city = city;
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
      artist_source_id: creatorId,
      institution_source_id: institutionSourceId,
    });
  }

  return {
    institutions: [...institutions.values()],
    artists: [...artists.values()],
    artworks: [...artworks.values()],
  };
}

function sqlText(value: string | null): string {
  if (value == null) return "null";
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlInt(value: number | null): string {
  return value == null ? "null" : String(Math.trunc(value));
}

function buildSeedSql(data: Mapped): string {
  const blocks: string[] = [
    "-- Dartabase seed: Wikidata (Australian artists and artworks)\n" +
      "-- Generated by scripts/ingest-wikidata.ts --emit-sql. Idempotent.",
  ];

  if (data.institutions.length > 0) {
    // For Wikidata-sourced institutions the source_id IS the QID, so it doubles
    // as wikidata_id; writing both at ingest time avoids the manual one-time
    // backfill that issue #24 captured.
    const rows = data.institutions.map(
      (institution) =>
        `  (${sqlText(SOURCE)}, ${sqlText(institution.source_id)}, ` +
        `${sqlText(institution.name)}, 'museum', ` +
        `${sqlText(institution.city)}, ` +
        `${sqlText(institution.website)}, ` +
        `${sqlText(institution.source_id)}, ` +
        `${sqlText(`https://www.wikidata.org/wiki/${institution.source_id}`)})`,
    );
    // coalesce keeps any city / wikidata_id already in the database if a
    // future row arrives with null for them, so a backfill is never undone.
    blocks.push(
      "insert into institutions (source, source_id, name, type, city, website, wikidata_id, source_url)\n" +
        `values\n${rows.join(",\n")}\n` +
        "on conflict (source, source_id) do update set\n" +
        "  name = excluded.name,\n" +
        "  city = coalesce(excluded.city, institutions.city),\n" +
        "  website = excluded.website,\n" +
        "  wikidata_id = coalesce(excluded.wikidata_id, institutions.wikidata_id),\n" +
        "  source_url = excluded.source_url;",
    );
  }

  const artistRows = data.artists.map(
    (artist) =>
      `  (${sqlText(SOURCE)}, ${sqlText(artist.source_id)}, ` +
      `${sqlText(artist.name)}, ${sqlInt(artist.birth_year)}, ` +
      `${sqlInt(artist.death_year)}, 'Australian', ` +
      `${sqlText(artist.source_id)}, ` +
      `${sqlText(`https://www.wikidata.org/wiki/${artist.source_id}`)})`,
  );
  blocks.push(
    "insert into artists (source, source_id, name, birth_year, death_year, nationality, wikidata_id, source_url)\n" +
      `values\n${artistRows.join(",\n")}\n` +
      "on conflict (source, source_id) do update set\n" +
      "  name = excluded.name, birth_year = excluded.birth_year,\n" +
      "  death_year = excluded.death_year, nationality = excluded.nationality,\n" +
      "  wikidata_id = excluded.wikidata_id, source_url = excluded.source_url;",
  );

  const artworkRows = data.artworks.map(
    (artwork) =>
      `  (${sqlText(SOURCE)}, ${sqlText(artwork.source_id)}, ` +
      `${sqlText(artwork.title)}, ${sqlText(artwork.date_text)}, ` +
      `${sqlInt(artwork.date_year)}, ${sqlText(artwork.image_url)}, ` +
      `'Wikimedia Commons (see source)', ${sqlText(artwork.source_id)}, ` +
      `${sqlText(artwork.source_url)}, ${sqlText(artwork.artist_source_id)}, ` +
      `${sqlText(artwork.institution_source_id)})`,
  );
  blocks.push(
    "insert into artworks (\n" +
      "  source, source_id, title, date_text, date_year, image_url,\n" +
      "  image_license, wikidata_id, source_url, artist_id, current_institution_id)\n" +
      "select\n" +
      "  v.source, v.source_id, v.title, v.date_text, v.date_year::int,\n" +
      "  v.image_url, v.image_license, v.wikidata_id, v.source_url,\n" +
      "  (select id from artists a where a.source = 'wikidata' and a.source_id = v.artist_source_id),\n" +
      "  (select id from institutions i where i.source = 'wikidata' and i.source_id = v.institution_source_id)\n" +
      `from (values\n${artworkRows.join(",\n")}\n) as v(\n` +
      "  source, source_id, title, date_text, date_year, image_url,\n" +
      "  image_license, wikidata_id, source_url, artist_source_id, institution_source_id)\n" +
      "on conflict (source, source_id) do update set\n" +
      "  title = excluded.title, date_text = excluded.date_text,\n" +
      "  date_year = excluded.date_year, image_url = excluded.image_url,\n" +
      "  image_license = excluded.image_license, wikidata_id = excluded.wikidata_id,\n" +
      "  source_url = excluded.source_url, artist_id = excluded.artist_id,\n" +
      "  current_institution_id = excluded.current_institution_id;",
  );

  return blocks.join("\n\n") + "\n";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[ingest:wikidata] ${args.dryRun ? "DRY RUN" : "EMIT SQL"}: limit=${args.limit}`,
  );

  const bindings = await runSparql(sparql(args.limit));
  console.log(`[ingest:wikidata] SPARQL returned ${bindings.length} rows`);

  const data = mapBindings(bindings);
  console.log(
    `[ingest:wikidata] mapped ${data.artworks.length} artworks, ` +
      `${data.artists.length} artists, ${data.institutions.length} institutions`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:wikidata] DRY RUN: sample of 3 artworks:\n");
    for (const artwork of data.artworks.slice(0, 3)) {
      console.log(JSON.stringify(artwork, null, 2));
    }
    console.log("\n[ingest:wikidata] DRY RUN: all institutions:\n");
    for (const institution of data.institutions) {
      console.log(JSON.stringify(institution));
    }
    return;
  }

  const seedSql = buildSeedSql(data);
  writeFileSync(args.emitSql as string, seedSql, "utf8");
  console.log(
    `\n[ingest:wikidata] wrote idempotent SQL seed to ${args.emitSql} ` +
      `(${seedSql.length} bytes).`,
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:wikidata] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
