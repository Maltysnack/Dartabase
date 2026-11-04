// Wikidata enrichment for canonical artists (issue #13).
//
// For each canonical artist that carries a Wikidata Q-ID (directly or via a
// GND identifier we can resolve), fetch:
//   - portrait image (P18, via Wikimedia Commons Special:FilePath)
//   - occupations (P106, top three)
//   - country of citizenship (P27)
//   - art movements (P135)
//   - birth/death (P569/P570) as a backfill
// Then synthesise a short factual bio in the Dartabase standard
// ("Spanish painter, sculptor, printmaker. 1881–1973.") and write everything
// back to the artist row.
//
// Phase A: matches on existing wikidata_id and on GND ID. Name+date
// reconciliation is a separate later session.
//
// Examples:
//   pnpm enrich:wikidata -- --dry-run --limit 5
//   pnpm enrich:wikidata -- --limit 644

import { createAdminClient } from "./lib/supabase-admin";

const SPARQL = "https://query.wikidata.org/sparql";
const USER_AGENT = "Dartabase/0.1 (https://github.com/Maltysnack/Dartabase)";
const BATCH = 40;
const DEFAULT_DELAY_MS = 800;
const OCCUPATION_CAP = 3;
const MOVEMENT_CAP = 3;

// Acceptlist of art-relevant occupations (issue #25). Wikidata's P106 set is
// often polluted by incidental credits ("screenwriter" because the artist's
// work appeared in a film, "writer" because they signed a manifesto), so we
// only surface labels from this list. Order is the priority order used when
// ranking; "painter" beats "draftsman" when both apply.
//
// Labels are matched case-insensitively against Wikidata's English label for
// the P106 value. Add new entries as enrichment turns up genuine art-practice
// labels we missed.
const ART_OCCUPATIONS: readonly string[] = [
  "painter",
  "sculptor",
  "printmaker",
  "photographer",
  "draftsman",
  "illustrator",
  "engraver",
  "etcher",
  "lithographer",
  "ceramicist",
  "ceramist",
  "muralist",
  "calligrapher",
  "woodcarver",
  "architect",
  "designer",
  "graphic designer",
  "industrial designer",
  "textile designer",
  "jewellery designer",
  "fashion designer",
  "performance artist",
  "video artist",
  "installation artist",
  "conceptual artist",
  "mixed-media artist",
  "collage artist",
  "watercolorist",
  "watercolourist",
  "miniature painter",
  "weaver",
  "potter",
  "goldsmith",
  "silversmith",
  "glassmaker",
] as const;
// Returns acceptlisted occupations from a raw Wikidata P106 label set, ranked
// by the order they appear in ART_OCCUPATIONS so output is deterministic.
function filterArtOccupations(raw: Iterable<string>): string[] {
  const have = new Set<string>();
  for (const o of raw) have.add(o.toLowerCase());
  return ART_OCCUPATIONS.filter((o) => have.has(o.toLowerCase()));
}

interface Args {
  limit: number;
  delayMs: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | undefined;
  let delayMs = DEFAULT_DELAY_MS;
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
        "Example: pnpm enrich:wikidata -- --dry-run --limit 5",
    );
  }
  return { limit, delayMs, dryRun };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Country name -> demonym so "Spain" reads as "Spanish painter" in the bio.
// Wikidata returns country names, not demonyms; rather than fetch a second
// property we maintain a small explicit map and fall back to the raw label.
const DEMONYM: Record<string, string> = {
  Australia: "Australian",
  Austria: "Austrian",
  Belgium: "Belgian",
  Brazil: "Brazilian",
  Canada: "Canadian",
  China: "Chinese",
  Denmark: "Danish",
  "Dutch Republic": "Dutch",
  Egypt: "Egyptian",
  Finland: "Finnish",
  France: "French",
  "Kingdom of France": "French",
  "French Republic": "French",
  "First French Empire": "French",
  Germany: "German",
  "German Empire": "German",
  "Holy Roman Empire": "German",
  "Kingdom of Prussia": "Prussian",
  "Kingdom of Bavaria": "Bavarian",
  "Duchy of Bavaria": "Bavarian",
  "Weimar Republic": "German",
  Greece: "Greek",
  Hungary: "Hungarian",
  India: "Indian",
  Iran: "Iranian",
  Ireland: "Irish",
  Israel: "Israeli",
  Italy: "Italian",
  "Kingdom of Italy": "Italian",
  "Republic of Venice": "Venetian",
  "Republic of Florence": "Florentine",
  Japan: "Japanese",
  Korea: "Korean",
  Lebanon: "Lebanese",
  Mexico: "Mexican",
  Netherlands: "Dutch",
  "New Zealand": "New Zealand",
  Norway: "Norwegian",
  Pakistan: "Pakistani",
  Poland: "Polish",
  Portugal: "Portuguese",
  Russia: "Russian",
  "Russian Empire": "Russian",
  Scotland: "Scottish",
  "South Africa": "South African",
  "South Korea": "Korean",
  "Soviet Union": "Soviet",
  Spain: "Spanish",
  "Kingdom of Spain": "Spanish",
  "Habsburg Spain": "Spanish",
  Sweden: "Swedish",
  Switzerland: "Swiss",
  Turkey: "Turkish",
  Ukraine: "Ukrainian",
  "United Kingdom": "British",
  England: "English",
  "United States": "American",
  "United States of America": "American",
};

function demonymOf(country: string | null): string | null {
  if (!country) return null;
  return DEMONYM[country] ?? country;
}

function yearFromIso(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const m = iso.match(/-?\d{1,4}/);
  return m ? Number(m[0]) : null;
}

function lifeSpan(birth: number | null, death: number | null): string {
  if (birth != null && death != null) return `${birth}–${death}`;
  if (birth != null) return `b. ${birth}`;
  if (death != null) return `d. ${death}`;
  return "";
}

// Synthesises the Dartabase-standard short factual bio (#21 + #25).
// Format depends on what we have:
//   demonym + acceptlisted occupations + span:
//     "Spanish painter, sculptor, printmaker. 1881-1973."
//   demonym + span:
//     "Spanish, 1881-1973."
//   demonym only / span only / occupations only: best effort.
// Occupations are filtered through ART_OCCUPATIONS by the caller before
// being passed in, so this function trusts them. Empty/null input returns
// null and the caller leaves bio unchanged.
function synthBio(
  nationality: string | null,
  occupations: string[],
  birth: number | null,
  death: number | null,
): string | null {
  const demonym = demonymOf(nationality);
  const span = lifeSpan(birth, death);
  const roles = occupations.length > 0 ? occupations.join(", ") : "";

  let lead: string | null = null;
  if (demonym && roles) lead = `${demonym} ${roles}`;
  else if (demonym && span) lead = `${demonym},`;
  else if (demonym) lead = demonym;
  else if (roles) lead = roles.charAt(0).toUpperCase() + roles.slice(1);

  const parts: string[] = [];
  if (lead) {
    // The "demonym, " form (no roles, has span) ends with a comma; everything
    // else ends with a period.
    parts.push(lead.endsWith(",") ? lead : `${lead}.`);
  }
  if (span) parts.push(`${span}.`);
  if (parts.length === 0) return null;
  return parts.join(" ");
}

// Wikidata's P18 SPARQL value is a Special:FilePath URL on commons. Make sure
// it is https and trimmed.
function normalizeImage(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/^http:/, "https:");
}

interface SparqlBinding {
  [key: string]: { type: string; value: string } | undefined;
}
interface SparqlResponse {
  results: { bindings: SparqlBinding[] };
}

async function sparql(query: string): Promise<SparqlBinding[]> {
  const body = new URLSearchParams({ query });
  const res = await fetch(SPARQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/sparql-results+json",
      "User-Agent": USER_AGENT,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Wikidata SPARQL ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as SparqlResponse;
  return json.results.bindings;
}

function qidFromUri(uri: string): string {
  const tail = uri.split("/").pop() ?? "";
  return tail;
}

// Resolve a batch of GND identifiers to Q-IDs in one SPARQL query.
async function resolveGndBatch(gnds: string[]): Promise<Map<string, string>> {
  if (gnds.length === 0) return new Map();
  const values = gnds.map((g) => `"${g.replace(/"/g, "")}"`).join(" ");
  const query = `SELECT ?qid ?gnd WHERE { VALUES ?gnd { ${values} } ?qid wdt:P227 ?gnd. }`;
  const rows = await sparql(query);
  const out = new Map<string, string>();
  for (const row of rows) {
    const qid = qidFromUri(row.qid?.value ?? "");
    const gnd = row.gnd?.value ?? "";
    if (qid && gnd) out.set(gnd, qid);
  }
  return out;
}

interface EnrichmentRaw {
  qid: string;
  label?: string;
  birth?: number;
  death?: number;
  countries: Set<string>;
  occupations: Set<string>;
  movements: Set<string>;
  image?: string;
  website?: string;
  wikipedia?: string;
}

// Batched enrichment. Cross-product rows from SPARQL are folded per artist.
async function fetchEnrichment(qids: string[]): Promise<Map<string, EnrichmentRaw>> {
  if (qids.length === 0) return new Map();
  const values = qids.map((q) => `wd:${q}`).join(" ");
  const query = `SELECT ?artist ?artistLabel ?birth ?death ?countryLabel ?occLabel ?movementLabel ?image ?website ?wpname WHERE {
    VALUES ?artist { ${values} }
    OPTIONAL { ?artist wdt:P569 ?birth. }
    OPTIONAL { ?artist wdt:P570 ?death. }
    OPTIONAL { ?artist wdt:P27 ?country. }
    OPTIONAL { ?artist wdt:P106 ?occ. }
    OPTIONAL { ?artist wdt:P135 ?movement. }
    OPTIONAL { ?artist wdt:P18 ?image. }
    OPTIONAL { ?artist wdt:P856 ?website. }
    OPTIONAL { ?wppage schema:about ?artist ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?wpname. }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`;
  const rows = await sparql(query);
  const out = new Map<string, EnrichmentRaw>();
  for (const row of rows) {
    const qid = qidFromUri(row.artist?.value ?? "");
    if (!qid) continue;
    let e = out.get(qid);
    if (!e) {
      e = {
        qid,
        countries: new Set(),
        occupations: new Set(),
        movements: new Set(),
      };
      out.set(qid, e);
    }
    if (row.artistLabel?.value && !e.label) e.label = row.artistLabel.value;
    if (row.birth?.value && e.birth == null) {
      e.birth = yearFromIso(row.birth.value) ?? undefined;
    }
    if (row.death?.value && e.death == null) {
      e.death = yearFromIso(row.death.value) ?? undefined;
    }
    if (row.countryLabel?.value) e.countries.add(row.countryLabel.value);
    if (row.occLabel?.value) e.occupations.add(row.occLabel.value);
    if (row.movementLabel?.value) e.movements.add(row.movementLabel.value);
    if (row.image?.value && !e.image) e.image = row.image.value;
    if (row.website?.value && !e.website) e.website = row.website.value;
    if (row.wpname?.value && !e.wikipedia) {
      e.wikipedia = `https://en.wikipedia.org/wiki/${encodeURIComponent(row.wpname.value)}`;
    }
  }
  return out;
}

interface ArtistRow {
  id: string;
  name: string;
  wikidata_id: string | null;
  gnd_id: string | null;
  nationality: string | null;
  bio: string | null;
  birth_year: number | null;
  death_year: number | null;
  image_url: string | null;
  movements: string[];
  website_url: string | null;
  wikipedia_url: string | null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[enrich:wikidata] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  const supabase = createAdminClient();

  const { data: rows, error } = await supabase
    .from("artists")
    .select(
      "id,name,wikidata_id,gnd_id,nationality,bio,birth_year,death_year,image_url,movements,website_url,wikipedia_url",
    )
    .is("merged_into", null)
    .or("wikidata_id.not.is.null,gnd_id.not.is.null")
    .limit(args.limit);
  if (error) throw error;
  const artists = (rows ?? []) as ArtistRow[];
  console.log(`[enrich:wikidata] ${artists.length} candidates loaded`);

  // Step 1: gather GNDs needing QID resolution.
  const needQidFromGnd = artists.filter((a) => !a.wikidata_id && a.gnd_id);
  const gndToQid = new Map<string, string>();
  for (let i = 0; i < needQidFromGnd.length; i += BATCH) {
    const batch = needQidFromGnd.slice(i, i + BATCH);
    const gnds = batch.map((a) => a.gnd_id as string);
    const resolved = await resolveGndBatch(gnds);
    for (const [gnd, qid] of resolved) gndToQid.set(gnd, qid);
    if (i + BATCH < needQidFromGnd.length) await sleep(args.delayMs);
  }
  console.log(
    `[enrich:wikidata] resolved ${gndToQid.size}/${needQidFromGnd.length} GND -> QID`,
  );

  // Step 2: build {artist_id -> qid} map.
  const artistToQid = new Map<string, string>();
  for (const a of artists) {
    let qid = a.wikidata_id;
    if (!qid && a.gnd_id) qid = gndToQid.get(a.gnd_id) ?? null;
    if (qid) artistToQid.set(a.id, qid);
  }
  const allQids = [...new Set(artistToQid.values())];
  console.log(`[enrich:wikidata] ${allQids.length} distinct QIDs to enrich`);

  // Step 3: batched enrichment fetch.
  const enriched = new Map<string, EnrichmentRaw>();
  for (let i = 0; i < allQids.length; i += BATCH) {
    const batch = allQids.slice(i, i + BATCH);
    const result = await fetchEnrichment(batch);
    for (const [k, v] of result) enriched.set(k, v);
    if (i + BATCH < allQids.length) await sleep(args.delayMs);
  }
  console.log(
    `[enrich:wikidata] fetched data for ${enriched.size} QIDs`,
  );

  // Step 4: assemble row updates.
  type Update = {
    id: string;
    name: string;
    fields: Record<string, unknown>;
    preview: string | null;
  };
  const updates: Update[] = [];

  for (const artist of artists) {
    const qid = artistToQid.get(artist.id);
    if (!qid) continue;
    const data = enriched.get(qid);
    if (!data) continue;

    const fields: Record<string, unknown> = {};

    if (!artist.wikidata_id) fields.wikidata_id = qid;

    // Backfill missing scalar fields.
    if (artist.birth_year == null && data.birth != null) fields.birth_year = data.birth;
    if (artist.death_year == null && data.death != null) fields.death_year = data.death;

    const country = [...data.countries][0] ?? null;
    const demonymOrCountry = demonymOf(country);
    if (!artist.nationality && demonymOrCountry) {
      fields.nationality = demonymOrCountry;
    }
    // Filter through the art acceptlist first, then cap, so the slice never
    // throws away a "painter" in favour of "screenwriter" (#25).
    const occupations = filterArtOccupations(data.occupations).slice(
      0,
      OCCUPATION_CAP,
    );

    // Bio: rebuild from the enriched + existing fields.
    const finalNationality = (fields.nationality as string) ?? artist.nationality;
    const finalBirth = (fields.birth_year as number) ?? artist.birth_year;
    const finalDeath = (fields.death_year as number) ?? artist.death_year;
    const bio = synthBio(finalNationality, occupations, finalBirth, finalDeath);
    if (bio && bio !== artist.bio) fields.bio = bio;

    const image = normalizeImage(data.image ?? null);
    if (image && image !== artist.image_url) fields.image_url = image;

    if (data.website && !artist.website_url) fields.website_url = data.website;
    if (data.wikipedia && !artist.wikipedia_url) fields.wikipedia_url = data.wikipedia;

    const movements = [...data.movements].slice(0, MOVEMENT_CAP);
    if (movements.length > 0) {
      const same =
        movements.length === artist.movements.length &&
        movements.every((m, i) => m === artist.movements[i]);
      if (!same) fields.movements = movements;
    }

    if (Object.keys(fields).length > 0) {
      updates.push({
        id: artist.id,
        name: artist.name,
        fields,
        preview: bio,
      });
    }
  }

  console.log(`[enrich:wikidata] ${updates.length} rows to update`);

  if (args.dryRun) {
    console.log("\n[enrich:wikidata] DRY RUN: first 3 row updates:\n");
    for (const u of updates.slice(0, 3)) {
      console.log(`${u.name} (${u.id.slice(0, 8)})`);
      console.log(JSON.stringify(u.fields, null, 2));
      console.log();
    }
    return;
  }

  let written = 0;
  for (const u of updates) {
    const { error: err } = await supabase
      .from("artists")
      .update(u.fields)
      .eq("id", u.id);
    if (err) {
      console.error(`  update ${u.name}: ${err.message}`);
      continue;
    }
    written++;
  }
  console.log(`[enrich:wikidata] wrote ${written}/${updates.length} updates`);
  console.log("[enrich:wikidata] done.");
}

main().catch((err: unknown) => {
  console.error(
    "[enrich:wikidata] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
