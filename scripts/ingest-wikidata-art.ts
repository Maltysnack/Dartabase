// Ingestion adapter for major museums that are NOT directly API-accessible but
// are richly catalogued on Wikidata, with public-domain images on Wikimedia
// Commons. One museum per `--museum` key; each is a Wikidata "collection"
// (P195) QID. English labels make these far more usable for research than the
// source museums' own (often non-English) feeds.
//
//   pnpm ingest:uffizi -- --dry-run --limit 50
//   pnpm ingest:nationalmuseum-se -- --limit 5000
//
// Images: we take Wikidata P18 (image), served from Commons (already an allowed
// image host). Commons hosts only freely-licensed files; for these collections
// they are overwhelmingly public-domain reproductions of historical art. We
// record P6216 (copyright status) in image_license for provenance. source_url
// links to the Wikidata item (the data source), which links on to the museum.
//
// Upserts key on (source, source_id = Wikidata QID). Re-running is safe.

import { createAdminClient } from "./lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "Dartabase/1.0 (art reference aggregator; +https://github.com/Maltysnack/Dartabase)";
const PAGE_SIZE = 200;
const UPSERT_CHUNK = 500;
const PAGE_DELAY_MS = 300;

interface MuseumConfig {
  source: string;
  collectionQid: string;
  institution: {
    source: string;
    source_id: string;
    name: string;
    type: string;
    city: string;
    country: string;
    website: string;
    source_url: string;
  };
}

function inst(
  source: string,
  name: string,
  city: string,
  country: string,
  website: string,
): MuseumConfig["institution"] {
  return {
    source,
    source_id: `institution:${source}`,
    name,
    type: "museum",
    city,
    country,
    website,
    source_url: website,
  };
}

export const MUSEUMS: Record<string, MuseumConfig> = {
  uffizi: {
    source: "uffizi",
    collectionQid: "Q51252",
    institution: inst(
      "uffizi",
      "Uffizi Galleries",
      "Florence",
      "Italy",
      "https://www.uffizi.it/",
    ),
  },
  "nationalmuseum-se": {
    source: "nationalmuseum-se",
    collectionQid: "Q842858",
    institution: inst(
      "nationalmuseum-se",
      "Nationalmuseum",
      "Stockholm",
      "Sweden",
      "https://www.nationalmuseum.se/",
    ),
  },
  "ng-london": {
    source: "ng-london",
    collectionQid: "Q180788",
    institution: inst(
      "ng-london",
      "The National Gallery, London",
      "London",
      "United Kingdom",
      "https://www.nationalgallery.org.uk/",
    ),
  },
  prado: {
    source: "prado",
    collectionQid: "Q160112",
    institution: inst(
      "prado",
      "Museo Nacional del Prado",
      "Madrid",
      "Spain",
      "https://www.museodelprado.es/",
    ),
  },
  // These museums have no usable open API of their own (the reason their direct
  // ingestion issues stalled), but are well catalogued on Wikidata.
  fitzwilliam: {
    source: "fitzwilliam",
    collectionQid: "Q1421440",
    institution: inst(
      "fitzwilliam",
      "The Fitzwilliam Museum",
      "Cambridge",
      "United Kingdom",
      "https://fitzmuseum.cam.ac.uk/",
    ),
  },
  "scottish-national-gallery": {
    source: "scottish-national-gallery",
    collectionQid: "Q2051997",
    institution: inst(
      "scottish-national-gallery",
      "Scottish National Gallery",
      "Edinburgh",
      "United Kingdom",
      "https://www.nationalgalleries.org/",
    ),
  },
  "petit-palais": {
    source: "petit-palais",
    collectionQid: "Q1641836",
    institution: inst(
      "petit-palais",
      "Petit Palais",
      "Paris",
      "France",
      "https://www.petitpalais.paris.fr/",
    ),
  },
  "npm-taipei": {
    source: "npm-taipei",
    collectionQid: "Q540668",
    institution: inst(
      "npm-taipei",
      "National Palace Museum",
      "Taipei",
      "Taiwan",
      "https://www.npm.gov.tw/",
    ),
  },
  // Further major European collections (no own open API; rich on Wikidata).
  hermitage: {
    source: "hermitage",
    collectionQid: "Q132783",
    institution: inst(
      "hermitage",
      "Hermitage Museum",
      "Saint Petersburg",
      "Russia",
      "https://www.hermitagemuseum.org/",
    ),
  },
  belvedere: {
    source: "belvedere",
    collectionQid: "Q303139",
    institution: inst(
      "belvedere",
      "Belvedere",
      "Vienna",
      "Austria",
      "https://www.belvedere.at/",
    ),
  },
  mauritshuis: {
    source: "mauritshuis",
    collectionQid: "Q221092",
    institution: inst(
      "mauritshuis",
      "Mauritshuis",
      "The Hague",
      "Netherlands",
      "https://www.mauritshuis.nl/",
    ),
  },
  "wallace-collection": {
    source: "wallace-collection",
    collectionQid: "Q1976985",
    institution: inst(
      "wallace-collection",
      "The Wallace Collection",
      "London",
      "United Kingdom",
      "https://www.wallacecollection.org/",
    ),
  },
  frick: {
    source: "frick",
    collectionQid: "Q1192305",
    institution: inst(
      "frick",
      "The Frick Collection",
      "New York",
      "United States",
      "https://www.frick.org/",
    ),
  },
  thyssen: {
    source: "thyssen",
    collectionQid: "Q176251",
    institution: inst(
      "thyssen",
      "Museo Nacional Thyssen-Bornemisza",
      "Madrid",
      "Spain",
      "https://www.museothyssen.org/",
    ),
  },
  kunsthistorisches: {
    source: "kunsthistorisches",
    collectionQid: "Q95569",
    institution: inst(
      "kunsthistorisches",
      "Kunsthistorisches Museum",
      "Vienna",
      "Austria",
      "https://www.khm.at/",
    ),
  },
  "gemaeldegalerie-berlin": {
    source: "gemaeldegalerie-berlin",
    collectionQid: "Q165631",
    institution: inst(
      "gemaeldegalerie-berlin",
      "Gemäldegalerie",
      "Berlin",
      "Germany",
      "https://www.smb.museum/",
    ),
  },
  "hamburger-kunsthalle": {
    source: "hamburger-kunsthalle",
    collectionQid: "Q169542",
    institution: inst(
      "hamburger-kunsthalle",
      "Hamburger Kunsthalle",
      "Hamburg",
      "Germany",
      "https://www.hamburger-kunsthalle.de/",
    ),
  },
  boijmans: {
    source: "boijmans",
    collectionQid: "Q679527",
    institution: inst(
      "boijmans",
      "Museum Boijmans Van Beuningen",
      "Rotterdam",
      "Netherlands",
      "https://www.boijmans.nl/",
    ),
  },
  brera: {
    source: "brera",
    collectionQid: "Q1948674",
    institution: inst(
      "brera",
      "Pinacoteca di Brera",
      "Milan",
      "Italy",
      "https://pinacotecabrera.org/",
    ),
  },
  "alte-nationalgalerie": {
    source: "alte-nationalgalerie",
    collectionQid: "Q162111",
    institution: inst(
      "alte-nationalgalerie",
      "Alte Nationalgalerie",
      "Berlin",
      "Germany",
      "https://www.smb.museum/",
    ),
  },
  // First Latin American coverage (fills a geographic gap).
  // Fine-art (painting) collections, not anthropology/pre-Columbian holdings.
  masp: {
    source: "masp",
    collectionQid: "Q82941",
    institution: inst(
      "masp",
      "São Paulo Museum of Art (MASP)",
      "São Paulo",
      "Brazil",
      "https://masp.org.br/",
    ),
  },
  "bellas-artes-buenos-aires": {
    source: "bellas-artes-buenos-aires",
    collectionQid: "Q1848918",
    institution: inst(
      "bellas-artes-buenos-aires",
      "Museo Nacional de Bellas Artes",
      "Buenos Aires",
      "Argentina",
      "https://www.bellasartes.gob.ar/",
    ),
  },
  capodimonte: {
    source: "capodimonte",
    collectionQid: "Q1132918",
    institution: inst(
      "capodimonte",
      "Museo di Capodimonte",
      "Naples",
      "Italy",
      "https://capodimonte.cultura.gov.it/",
    ),
  },
  "npg-london": {
    source: "npg-london",
    collectionQid: "Q238587",
    institution: inst(
      "npg-london",
      "National Portrait Gallery",
      "London",
      "United Kingdom",
      "https://www.npg.org.uk/",
    ),
  },
  getty: {
    source: "getty",
    collectionQid: "Q731126",
    institution: inst(
      "getty",
      "J. Paul Getty Museum",
      "Los Angeles",
      "United States",
      "https://www.getty.edu/",
    ),
  },
  lenbachhaus: {
    source: "lenbachhaus",
    collectionQid: "Q262234",
    institution: inst(
      "lenbachhaus",
      "Lenbachhaus",
      "Munich",
      "Germany",
      "https://www.lenbachhaus.de/",
    ),
  },
  "van-gogh-museum": {
    source: "van-gogh-museum",
    collectionQid: "Q224124",
    institution: inst(
      "van-gogh-museum",
      "Van Gogh Museum",
      "Amsterdam",
      "Netherlands",
      "https://www.vangoghmuseum.nl/",
    ),
  },
  "frans-hals-museum": {
    source: "frans-hals-museum",
    collectionQid: "Q574961",
    institution: inst(
      "frans-hals-museum",
      "Frans Hals Museum",
      "Haarlem",
      "Netherlands",
      "https://www.franshalsmuseum.nl/",
    ),
  },
  "accademia-florence": {
    source: "accademia-florence",
    collectionQid: "Q338330",
    institution: inst(
      "accademia-florence",
      "Galleria dell'Accademia",
      "Florence",
      "Italy",
      "https://www.galleriaaccademiafirenze.it/",
    ),
  },
  "kroller-muller": {
    source: "kroller-muller",
    collectionQid: "Q924335",
    institution: inst(
      "kroller-muller",
      "Kröller-Müller Museum",
      "Otterlo",
      "Netherlands",
      "https://krollermuller.nl/",
    ),
  },
  "national-museum-warsaw": {
    source: "national-museum-warsaw",
    collectionQid: "Q153306",
    institution: inst(
      "national-museum-warsaw",
      "National Museum in Warsaw",
      "Warsaw",
      "Poland",
      "https://www.mnw.art.pl/",
    ),
  },
  orsay: {
    source: "orsay",
    collectionQid: "Q23402",
    institution: inst(
      "orsay",
      "Musée d'Orsay",
      "Paris",
      "France",
      "https://www.musee-orsay.fr/",
    ),
  },
  "kunsthaus-zurich": {
    source: "kunsthaus-zurich",
    collectionQid: "Q685038",
    institution: inst(
      "kunsthaus-zurich",
      "Kunsthaus Zürich",
      "Zurich",
      "Switzerland",
      "https://www.kunsthaus.ch/",
    ),
  },
  "kunstmuseum-basel": {
    source: "kunstmuseum-basel",
    collectionQid: "Q194626",
    institution: inst(
      "kunstmuseum-basel",
      "Kunstmuseum Basel",
      "Basel",
      "Switzerland",
      "https://www.kunstmuseumbasel.ch/",
    ),
  },
  "ng-prague": {
    source: "ng-prague",
    collectionQid: "Q1499958",
    institution: inst(
      "ng-prague",
      "National Gallery Prague",
      "Prague",
      "Czech Republic",
      "https://www.ngprague.cz/",
    ),
  },
  albertina: {
    source: "albertina",
    collectionQid: "Q371908",
    institution: inst(
      "albertina",
      "Albertina",
      "Vienna",
      "Austria",
      "https://www.albertina.at/",
    ),
  },
  "bavarian-state-paintings": {
    source: "bavarian-state-paintings",
    collectionQid: "Q812285",
    institution: inst(
      "bavarian-state-paintings",
      "Bavarian State Painting Collections",
      "Munich",
      "Germany",
      "https://www.pinakothek.de/",
    ),
  },
  // Australian galleries: no open API, but catalogued on Wikidata. Most works
  // there have no Commons image (in copyright), so run these with
  // --metadata-only and link out to the gallery via the Wikidata item.
  ngv: {
    source: "ngv",
    collectionQid: "Q1464509",
    institution: inst(
      "ngv",
      "National Gallery of Victoria",
      "Melbourne",
      "Australia",
      "https://www.ngv.vic.gov.au/",
    ),
  },
  agnsw: {
    source: "agnsw",
    collectionQid: "Q705551",
    institution: inst(
      "agnsw",
      "Art Gallery of New South Wales",
      "Sydney",
      "Australia",
      "https://www.artgallery.nsw.gov.au/",
    ),
  },
  "nga-au": {
    source: "nga-au",
    collectionQid: "Q795228",
    institution: inst(
      "nga-au",
      "National Gallery of Australia",
      "Canberra",
      "Australia",
      "https://nga.gov.au/",
    ),
  },
  agsa: {
    source: "agsa",
    collectionQid: "Q705557",
    institution: inst(
      "agsa",
      "Art Gallery of South Australia",
      "Adelaide",
      "Australia",
      "https://www.agsa.sa.gov.au/",
    ),
  },
  agwa: {
    source: "agwa",
    collectionQid: "Q4796833",
    institution: inst(
      "agwa",
      "Art Gallery of Western Australia",
      "Perth",
      "Australia",
      "https://artgallery.wa.gov.au/",
    ),
  },
};

interface Args {
  museum: string;
  limit: number;
  dryRun: boolean;
  metadataOnly: boolean;
  requireArtist: boolean;
}

function parseArgs(argv: string[]): Args {
  let museum: string | undefined;
  let limit: number | undefined;
  let dryRun = false;
  let metadataOnly = false;
  let requireArtist = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--metadata-only") metadataOnly = true;
    else if (arg === "--require-artist") requireArtist = true;
    else if (arg === "--museum") museum = argv[++i];
    else if (arg === "--limit") limit = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!museum || !MUSEUMS[museum]) {
    throw new Error(
      `--museum <key> is required, one of: ${Object.keys(MUSEUMS).join(", ")}`,
    );
  }
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    throw new Error("--limit <n> is required (a positive integer).");
  }
  return { museum, limit, dryRun, metadataOnly, requireArtist };
}

export function qid(entityUrl: string): string {
  return entityUrl.split("/").pop() ?? entityUrl;
}

// When an entity has no English label, the label service returns the bare QID.
export function isBareQid(value: string | undefined | null): boolean {
  return !!value && /^Q\d+$/.test(value.trim());
}

// Blank nodes (e.g. anonymous "creator" entities) have no rdfs:label, so the
// label service falls back to the entity's own URI, including for genid
// blank-node URIs which aren't real QIDs at all.
export function isRealQidUri(entityUrl: string | undefined | null): boolean {
  return !!entityUrl && /\/entity\/Q\d+$/.test(entityUrl);
}

export function yearOf(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^(-?\d+)/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) ? y : null;
}

// P18 image values are Commons Special:FilePath URLs; request a display size.
export function imageUrl(raw: string): string {
  const https = raw.replace(/^http:/, "https:");
  return `${https}${https.includes("?") ? "&" : "?"}width=800`;
}

interface Binding {
  [key: string]: { value: string } | undefined;
}

export interface MappedArtwork {
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
  cultural_notice: boolean;
  source_url: string;
  wikidata_id: string;
  artist_source_id: string | null;
}

export interface Artist {
  source_id: string;
  name: string;
  nationality: null;
  birth_year: number | null;
  death_year: number | null;
  wikidata_id: string;
}

// Map a SPARQL binding to an artwork (+ artist when a named creator exists).
// Returns null for rows without a usable English title.
export function mapBinding(
  b: Binding,
  source: string,
  metadataOnly = false,
): { artwork: MappedArtwork; artist: Artist | null } | null {
  const get = (k: string) => b[k]?.value;
  const artworkUri = get("artwork");
  const title = get("artworkLabel");
  const image = get("image");
  if (!artworkUri || (!image && !metadataOnly) || !title || isBareQid(title))
    return null;

  const id = qid(artworkUri);
  const creatorUri = get("creator");
  const creatorLabel = get("creatorLabel");
  const hasArtist =
    creatorUri &&
    creatorLabel &&
    !isBareQid(creatorLabel) &&
    isRealQidUri(creatorUri);
  const artistSourceId = hasArtist ? qid(creatorUri) : null;

  const copyright = get("copyrightLabel");
  const materials = get("materials"); // GROUP_CONCAT, "" when none
  const h = get("h");
  const w = get("w");
  return {
    artwork: {
      source,
      source_id: id,
      title,
      date_text: yearOf(get("inception"))?.toString() ?? null,
      date_year: yearOf(get("inception")),
      medium: materials || null,
      dimensions: h && w ? `${h} × ${w} cm` : null,
      credit_line: null,
      image_url: image && !metadataOnly ? imageUrl(image) : null,
      image_license:
        image && !metadataOnly
          ? copyright && !isBareQid(copyright)
            ? copyright
            : "Wikimedia Commons"
          : null,
      cultural_notice: false, // set from the creators' ethnic group in main()
      source_url: `https://www.wikidata.org/wiki/${id}`,
      wikidata_id: id,
      artist_source_id: artistSourceId,
    },
    artist: hasArtist
      ? {
          source_id: artistSourceId as string,
          name: creatorLabel as string,
          nationality: null,
          birth_year: null,
          death_year: null,
          wikidata_id: artistSourceId as string,
        }
      : null,
  };
}

// Keyset pagination by the artwork URI: robust where large OFFSETs time out.
function buildQuery(
  collectionQid: string,
  afterUri: string,
  metadataOnly: boolean,
): string {
  return `
SELECT ?artwork ?artworkLabel ?creator ?creatorLabel ?inception ${metadataOnly ? "" : "?image "}?copyrightLabel
       (GROUP_CONCAT(DISTINCT ?matLabel; SEPARATOR=", ") AS ?materials)
       (SAMPLE(?height) AS ?h) (SAMPLE(?width) AS ?w) WHERE {
  ?artwork wdt:P195 wd:${collectionQid} .${metadataOnly ? "" : " ?artwork wdt:P18 ?image ."}
  OPTIONAL { ?artwork wdt:P170 ?creator . }
  OPTIONAL { ?artwork wdt:P571 ?inception . }
  OPTIONAL { ?artwork wdt:P6216 ?copyright . }
  OPTIONAL { ?artwork wdt:P186 ?mat . ?mat rdfs:label ?matLabel . FILTER(LANG(?matLabel) = "en") }
  OPTIONAL { ?artwork wdt:P2048 ?height . }
  OPTIONAL { ?artwork wdt:P2049 ?width . }
  FILTER(STR(?artwork) > "${afterUri}")
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?artwork ?artworkLabel ?creator ?creatorLabel ?inception ${metadataOnly ? "" : "?image "}?copyrightLabel
ORDER BY STR(?artwork)
LIMIT ${PAGE_SIZE}`;
}

async function runSparql(query: string): Promise<Binding[]> {
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    try {
      const res = await fetch(
        `${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`,
        {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/sparql-results+json",
          },
        },
      );
      status = res.status;
      if (res.ok) {
        const json = (await res.json()) as {
          results: { bindings: Binding[] };
        };
        return json.results.bindings;
      }
    } catch {
      // network error: retry below
    }
    if ((status >= 400 && status < 500 && status !== 429) || attempt >= 5) {
      throw new Error(`Wikidata SPARQL ${status || "request failed"}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
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
  const cfg = MUSEUMS[args.museum];
  const tag = `ingest:${cfg.source}`;
  console.log(`[${tag}] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}${args.metadataOnly ? " metadata-only" : ""}`);

  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, Artist>();
  const seen = new Set<string>();
  let after = "";

  while (artworks.length < args.limit) {
    const rows = await runSparql(buildQuery(cfg.collectionQid, after, args.metadataOnly));
    if (rows.length === 0) break;
    // Advance the keyset cursor to the last artwork URI of this page.
    after = rows[rows.length - 1].artwork?.value ?? after;
    for (const row of rows) {
      if (artworks.length >= args.limit) break;
      const mapped = mapBinding(row, cfg.source, args.metadataOnly);
      if (!mapped) continue;
      if (args.requireArtist && !mapped.artist) continue;
      if (seen.has(mapped.artwork.source_id)) continue; // multi-value rows
      seen.add(mapped.artwork.source_id);
      artworks.push(mapped.artwork);
      if (mapped.artist && !artists.has(mapped.artist.source_id)) {
        artists.set(mapped.artist.source_id, mapped.artist);
      }
    }
    console.log(`[${tag}] ${artworks.length} artworks so far`);
    if (artworks.length < args.limit) {
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
  }

  // Enrich artists with birth/death years (P569/P570) via cheap batched
  // queries. Valuable for lifespans and citation dates, and absent for many of
  // these Wikidata-only artists until folded by dedup.
  const firstNations = new Set<string>();
  const artistQids = [...artists.keys()];
  for (let i = 0; i < artistQids.length; i += 150) {
    const values = artistQids
      .slice(i, i + 150)
      .map((q) => `wd:${q}`)
      .join(" ");
    const rows = await runSparql(
      `SELECT ?artist (SAMPLE(?b) AS ?birth) (SAMPLE(?d) AS ?death) (GROUP_CONCAT(DISTINCT ?ethLabel; SEPARATOR="|") AS ?ethnic) WHERE { VALUES ?artist { ${values} } OPTIONAL { ?artist wdt:P569 ?b . } OPTIONAL { ?artist wdt:P570 ?d . } OPTIONAL { ?artist wdt:P172 ?eth . ?eth rdfs:label ?ethLabel . FILTER(LANG(?ethLabel) = "en") } } GROUP BY ?artist`,
    );
    for (const row of rows) {
      const a = artists.get(qid(row.artist?.value ?? ""));
      if (a) {
        a.birth_year = yearOf(row.birth?.value);
        a.death_year = yearOf(row.death?.value);
        // ICIP: flag works by creators Wikidata records as First Nations; a
        // conservative signal, so unflagged works still need human review.
        if (
          /aborigin|torres strait|indigenous|first nations|maori/i.test(
            row.ethnic?.value ?? "",
          )
        ) {
          firstNations.add(a.source_id);
        }
      }
    }
    if (i + 150 < artistQids.length) {
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
  }

  for (const a of artworks) {
    if (a.artist_source_id && firstNations.has(a.artist_source_id)) {
      a.cultural_notice = true;
    }
  }

  console.log(
    `[${tag}] mapped ${artworks.length} artworks (${artworks.filter((a) => a.image_url).length} imaged, ${artworks.filter((a) => a.cultural_notice).length} flagged ICIP, ${artworks.filter((a) => !a.artist_source_id).length} no named artist), ${artists.size} named artists`,
  );

  if (args.dryRun) {
    console.log(`\n[${tag}] DRY RUN: sample of 3 artworks:\n`);
    for (const s of artworks.slice(0, 3)) console.log(JSON.stringify(s, null, 2));
    console.log("\nSample artists (with enriched dates):");
    for (const a of [...artists.values()].slice(0, 3)) {
      console.log(JSON.stringify(a, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: institution, error: instErr } = await supabase
    .from("institutions")
    // The collection QID is the museum's own Wikidata entity, so record it for
    // institution dedup/provenance.
    .upsert(
      { ...cfg.institution, wikidata_id: cfg.collectionQid },
      { onConflict: "source,source_id" },
    )
    .select("id")
    .single();
  if (instErr) throw new Error(`upsert institution: ${instErr.message}`);
  const institutionId = institution.id as string;

  const artistRows = [...artists.values()].map((a) => ({
    source: cfg.source,
    source_id: a.source_id,
    name: a.name,
    nationality: a.nationality,
    birth_year: a.birth_year,
    death_year: a.death_year,
    wikidata_id: a.wikidata_id,
    source_url: `https://www.wikidata.org/wiki/${a.source_id}`,
  }));
  const upsertedArtists = artistRows.length
    ? await chunkedUpsert(
        supabase,
        "artists",
        artistRows as unknown as Record<string, unknown>[],
        "id,source_id",
      )
    : [];
  const artistIdBySourceId = new Map<string, string>(
    upsertedArtists.map((r) => [r.source_id as string, r.id as string]),
  );
  console.log(`[${tag}] upserted ${upsertedArtists.length} artists`);

  const artworkRows = artworks.map((a) => {
    const { artist_source_id, ...rest } = a;
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
    artworkRows as unknown as Record<string, unknown>[],
    "id",
  );
  console.log(`[${tag}] upserted ${upsertedArtworks.length} artworks`);
  console.log(`[${tag}] done. Run \`pnpm dedup\` to fold cross-source duplicates.`);
}

if (process.argv[1] && process.argv[1].endsWith("ingest-wikidata-art.ts")) {
  main().catch((err: unknown) => {
    console.error(
      "[ingest:wikidata-art] FAILED:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
