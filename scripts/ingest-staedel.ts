// Ingestion adapter for the Städel Museum, Frankfurt.
//
// Harvests records from Städel's OAI-PMH endpoint in the LIDO metadata format.
// No API key required. Upserts key on (source, source_id) with
// source = 'staedel', so re-running is idempotent.
//
// The 'scope:major' set is 1,638 masterpieces (paintings, sculpture, the
// highlights of the collection); 'scope:graphics' is ~29,000 prints/drawings.
// This first-run adapter targets scope:major; the graphics set is a separate
// later session.
//
// Examples:
//   pnpm ingest:staedel -- --dry-run --limit 10
//   pnpm ingest:staedel -- --limit 800

import { XMLParser } from "fast-xml-parser";
import { createAdminClient } from "./lib/supabase-admin";
import { flipSurnameFirst } from "./lib/staedel-parsers";
import { yearFromText } from "./lib/year";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE = "staedel";
const UPSERT_CHUNK = 500;
const OAI_BASE = "https://sammlung.staedelmuseum.de/api/oai";
const SET = "scope:major";
const METADATA_PREFIX = "lido";

// Image-rights URIs and labels we treat as openly publishable. Mirrors what
// Städel itself publishes via the OAI feed.
const OPEN_RIGHTS_TOKENS = [
  "creativecommons.org/publicdomain/mark",
  "creativecommons.org/publicdomain/zero",
  "creativecommons.org/licenses/by",
  "public domain",
  "cc0",
];

const ANONYMOUS_NAMES = new Set([
  "",
  "unknown",
  "unidentified",
  "anonymous",
  "anonym",
  "unbekannt",
]);

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
        "Example: pnpm ingest:staedel -- --dry-run --limit 10",
    );
  }
  return { limit, delayMs, dryRun };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function clean(value: string | undefined | null): string | null {
  if (value == null) return null;
  const normalized = String(value).replace(/\r\n?/g, "\n").trim();
  if (normalized === "") return null;
  return normalized.replace(/\s*\n\s*/g, "; ").replace(/[ \t]{2,}/g, " ");
}

// flipSurnameFirst now lives in scripts/lib/staedel-parsers.ts so it can be
// unit-tested without importing this adapter file (which runs main() at the
// bottom). See scripts/lib/staedel-parsers.test.ts for 6-case coverage.

// LIDO fields often arrive either as a single object or as an array,
// depending on whether the record carries one or many of that field. Coerce
// to an array for uniform iteration.
type Maybe<T> = T | T[] | undefined;
function asArray<T>(v: Maybe<T>): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// LIDO XML uses xml:lang attributes; fast-xml-parser surfaces them as
// '@_xml:lang' under each element. Pick the English variant when present,
// fall back to German (the catalogue is bilingual), else the first.
interface LangText {
  "#text"?: string;
  "@_xml:lang"?: string;
}
function pickLang(items: Maybe<LangText | string>): string | null {
  const arr = asArray<LangText | string>(items);
  if (arr.length === 0) return null;
  const stringify = (e: LangText | string): {
    lang: string;
    text: string;
  } | null => {
    if (typeof e === "string") {
      return { lang: "", text: e };
    }
    const text = clean(e["#text"]);
    if (!text) return null;
    return { lang: e["@_xml:lang"] ?? "", text };
  };
  const entries = arr.map(stringify).filter((x): x is { lang: string; text: string } => x != null);
  return (
    entries.find((e) => e.lang === "en")?.text ??
    entries.find((e) => e.lang === "de")?.text ??
    entries[0]?.text ??
    null
  );
}

// Find a nested object at a dotted path, walking past arrays as needed.
function nav(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) cur = cur[0];
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
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

const STAEDEL_INSTITUTION = {
  source: SOURCE,
  source_id: "institution:staedel",
  name: "Städel Museum",
  type: "museum",
  city: "Frankfurt am Main",
  country: "Germany",
  website: "https://www.staedelmuseum.de",
  source_url: "https://www.staedelmuseum.de",
};

// Pull the production event out of a LIDO record. A record may have several
// event types (creation, restoration, acquisition); we want type "production".
function findProductionEvent(record: unknown): unknown | null {
  const events = asArray(nav(record, "descriptiveMetadata.eventWrap.eventSet"));
  for (const evt of events) {
    const e = (evt as Record<string, unknown>)?.event;
    if (!e) continue;
    const types = asArray(nav(e, "eventType.term"));
    for (const t of types) {
      const text = typeof t === "string" ? t : (t as LangText)["#text"];
      if (typeof text === "string" && /production|herstellung/i.test(text)) {
        return e;
      }
    }
    // If only one event and no obvious production label, take it.
    if (events.length === 1) return e;
  }
  return events[0] ? (events[0] as Record<string, unknown>).event : null;
}

// Extract the artist (eventActor with role "artist" / "Künstler"). Returns
// null if the actor is anonymous or has no GND identifier.
function extractArtist(event: unknown): Artist | null {
  const actors = asArray(nav(event, "eventActor"));
  // Prefer an actor whose roleActor term mentions "artist" / "Künstler".
  let chosen: unknown = null;
  for (const a of actors) {
    const roleTerms = asArray(nav(a, "actorInRole.roleActor.term"));
    const hasArtistRole = roleTerms.some((t) => {
      const text = typeof t === "string" ? t : (t as LangText)["#text"];
      return typeof text === "string" && /artist|k[üu]nstler/i.test(text);
    });
    if (hasArtistRole) {
      chosen = a;
      break;
    }
  }
  if (!chosen) chosen = actors[0];
  if (!chosen) return null;

  const actor = nav(chosen, "actorInRole.actor");
  if (!actor) return null;

  // Stable GND identifier, e.g. "http://d-nb.info/gnd/11852786X".
  const actorIdRaw = nav(actor, "actorID");
  let gnd: string | null = null;
  if (typeof actorIdRaw === "string") {
    gnd = actorIdRaw;
  } else if (actorIdRaw && typeof actorIdRaw === "object") {
    gnd =
      typeof (actorIdRaw as LangText)["#text"] === "string"
        ? (actorIdRaw as LangText)["#text"]!
        : null;
  }
  const gndId = gnd ? gnd.split("/").pop() ?? null : null;
  if (!gndId) return null;

  const nameRaw =
    pickLang(nav(actor, "nameActorSet.appellationValue") as Maybe<LangText | string>);
  if (!nameRaw) return null;
  const name = flipSurnameFirst(nameRaw);
  if (ANONYMOUS_NAMES.has(name.toLowerCase())) return null;

  const vital = nav(actor, "vitalDatesActor");
  const birth = vital
    ? yearFromText(
        typeof (vital as Record<string, unknown>).earliestDate === "object"
          ? ((vital as Record<string, Record<string, unknown>>).earliestDate[
              "#text"
            ] as string)
          : ((vital as Record<string, unknown>).earliestDate as string),
      )
    : null;
  const death = vital
    ? yearFromText(
        typeof (vital as Record<string, unknown>).latestDate === "object"
          ? ((vital as Record<string, Record<string, unknown>>).latestDate[
              "#text"
            ] as string)
          : ((vital as Record<string, unknown>).latestDate as string),
      )
    : null;

  return {
    source_id: `gnd:${gndId}`,
    name,
    birth_year: birth,
    death_year: death,
    nationality: null,
  };
}

function extractImageAndRights(record: unknown): {
  image_url: string | null;
  image_license: string | null;
  open: boolean;
} {
  const sets = asArray(nav(record, "administrativeMetadata.resourceWrap.resourceSet"));
  for (const set of sets) {
    const reps = asArray(nav(set, "resourceRepresentation"));
    let url: string | null = null;
    for (const rep of reps) {
      const repType = (rep as Record<string, unknown>)?.["@_type"] ?? "";
      const link = (rep as Record<string, unknown>)?.linkResource;
      const linkUrl =
        typeof link === "string"
          ? link
          : link && typeof link === "object"
            ? ((link as LangText)["#text"] ?? null)
            : null;
      if (!linkUrl) continue;
      // Prefer the thumb-lg variant, but accept any image rep we find.
      if (typeof repType === "string" && repType.includes("lido00451")) {
        if (linkUrl.includes("thumb-lg") || !url) url = linkUrl;
      } else if (!url) {
        url = linkUrl;
      }
    }
    const rightsTerm = nav(set, "rightsResource.rightsType.term");
    const rightsText =
      typeof rightsTerm === "string"
        ? rightsTerm
        : rightsTerm && typeof rightsTerm === "object"
          ? ((rightsTerm as LangText)["#text"] ?? null)
          : null;
    const rightsUri = nav(set, "rightsResource.rightsType.conceptID");
    const rightsUriText =
      typeof rightsUri === "string"
        ? rightsUri
        : rightsUri && typeof rightsUri === "object"
          ? ((rightsUri as LangText)["#text"] ?? null)
          : null;

    const open = OPEN_RIGHTS_TOKENS.some((tok) => {
      const hay = `${(rightsText ?? "").toLowerCase()} ${(rightsUriText ?? "").toLowerCase()}`;
      return hay.includes(tok);
    });

    if (url) {
      return {
        image_url: url,
        image_license: rightsText ? `Städel Museum, ${rightsText}` : "Städel Museum",
        open,
      };
    }
  }
  return { image_url: null, image_license: null, open: false };
}

function mapRecord(
  record: unknown,
): { artwork: MappedArtwork; artist: Artist } | null {
  const recordId = nav(record, "administrativeMetadata.recordWrap.recordID");
  let recordIdText: string | null = null;
  if (typeof recordId === "string" || typeof recordId === "number") {
    recordIdText = String(recordId);
  } else if (recordId && typeof recordId === "object") {
    const t = (recordId as LangText)["#text"];
    if (t != null) recordIdText = String(t);
  }
  if (!recordIdText) return null;

  const title = pickLang(
    nav(record, "descriptiveMetadata.objectIdentificationWrap.titleWrap.titleSet.appellationValue") as Maybe<LangText | string>,
  );
  if (!title) return null;

  const { image_url, image_license, open } = extractImageAndRights(record);
  if (!image_url || !open) return null;

  const event = findProductionEvent(record);
  const artist = event ? extractArtist(event) : null;
  if (!artist) return null;

  const dateText = pickLang(
    nav(event, "eventDate.displayDate") as Maybe<LangText | string>,
  );
  const dateYearRaw = nav(event, "eventDate.date.earliestDate");
  const dateYear =
    typeof dateYearRaw === "string"
      ? yearFromText(dateYearRaw)
      : dateYearRaw && typeof dateYearRaw === "object"
        ? yearFromText((dateYearRaw as LangText)["#text"])
        : yearFromText(dateText);

  const medium = pickLang(
    nav(event, "eventMaterialsTech.displayMaterialsTech") as Maybe<LangText | string>,
  );
  const dimensions = pickLang(
    nav(record, "descriptiveMetadata.objectIdentificationWrap.objectMeasurementsWrap.objectMeasurementsSet.displayObjectMeasurements") as Maybe<LangText | string>,
  );

  const recordLink = nav(record, "administrativeMetadata.recordWrap.recordInfoSet.recordInfoLink");
  const sourceUrl =
    typeof recordLink === "string"
      ? recordLink
      : recordLink && typeof recordLink === "object"
        ? ((recordLink as LangText)["#text"] ?? null)
        : null;

  const artwork: MappedArtwork = {
    source: SOURCE,
    source_id: recordIdText,
    title,
    date_text: clean(dateText),
    date_year: dateYear,
    medium: clean(medium),
    dimensions: clean(dimensions),
    credit_line: null,
    image_url,
    image_license,
    source_url: clean(sourceUrl),
    artist_source_id: artist.source_id,
  };
  return { artwork, artist };
}

interface OaiResponse {
  records: unknown[];
  resumptionToken: string | null;
  completeListSize: number | null;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseAttributeValue: false,
  trimValues: true,
});

async function fetchPage(resumptionToken: string | null): Promise<OaiResponse> {
  const url = resumptionToken
    ? `${OAI_BASE}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`
    : `${OAI_BASE}?verb=ListRecords&metadataPrefix=${METADATA_PREFIX}&set=${encodeURIComponent(SET)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Städel OAI ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  const json = xmlParser.parse(text) as Record<string, unknown>;
  const list = nav(json, "OAI-PMH.ListRecords") as Record<string, unknown> | undefined;
  if (!list) {
    throw new Error("OAI response missing ListRecords envelope");
  }
  const rawRecords = asArray(list.record);
  const live: unknown[] = [];
  for (const r of rawRecords) {
    const header = (r as Record<string, unknown>)?.header as
      | Record<string, unknown>
      | undefined;
    if (header && (header["@_status"] === "deleted")) continue;
    const metadata = (r as Record<string, unknown>)?.metadata as
      | Record<string, unknown>
      | undefined;
    const lido = nav(metadata, "lidoWrap.lido");
    if (!lido) continue;
    live.push(lido);
  }

  const rt = list.resumptionToken as
    | string
    | Record<string, unknown>
    | undefined;
  let token: string | null = null;
  let completeListSize: number | null = null;
  if (typeof rt === "string") {
    token = rt;
  } else if (rt && typeof rt === "object") {
    const text = (rt as LangText)["#text"];
    if (typeof text === "string" && text !== "") token = text;
    const size = (rt as Record<string, unknown>)["@_completeListSize"];
    if (typeof size === "string") completeListSize = Number(size);
  }

  return { records: live, resumptionToken: token, completeListSize };
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
    `[ingest:staedel] ${args.dryRun ? "DRY RUN" : "LIVE"}: limit=${args.limit}`,
  );

  const artworks: MappedArtwork[] = [];
  const artists = new Map<string, Artist>();
  let scanned = 0;
  let token: string | null = null;
  let firstPage = true;

  while (artworks.length < args.limit) {
    const page = await fetchPage(firstPage ? null : token);
    firstPage = false;
    if (page.records.length === 0 && !page.resumptionToken) break;
    if (page.completeListSize != null && scanned === 0) {
      console.log(
        `[ingest:staedel] set ${SET}: ${page.completeListSize} records available`,
      );
    }
    for (const record of page.records) {
      if (artworks.length >= args.limit) break;
      scanned++;
      const mapped = mapRecord(record);
      if (!mapped) continue;
      artworks.push(mapped.artwork);
      if (!artists.has(mapped.artist.source_id)) {
        artists.set(mapped.artist.source_id, mapped.artist);
      }
    }
    if (!page.resumptionToken) break;
    token = page.resumptionToken;
    if (args.delayMs > 0) await sleep(args.delayMs);
  }

  console.log(
    `[ingest:staedel] scanned ${scanned} records, mapped ${artworks.length} artworks, ${artists.size} artists`,
  );

  if (args.dryRun) {
    console.log("\n[ingest:staedel] DRY RUN: sample of 3 artworks:\n");
    for (const sample of artworks.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    return;
  }

  const supabase = createAdminClient();

  const { data: inst, error: instError } = await supabase
    .from("institutions")
    .upsert(STAEDEL_INSTITUTION, { onConflict: "source,source_id" })
    .select("id")
    .single();
  if (instError) throw new Error(`upsert institution: ${instError.message}`);
  const institutionId = inst.id as string;

  const artistRows = [...artists.values()].map((a) => {
    // a.source_id is "gnd:11852786X"; pull the bare GND for the dedicated
    // column so dedup/Wikidata enrichment can find it without parsing.
    const gnd = a.source_id.replace(/^gnd:/, "");
    return {
      source: SOURCE,
      source_id: a.source_id,
      name: a.name,
      birth_year: a.birth_year,
      death_year: a.death_year,
      nationality: a.nationality,
      gnd_id: gnd,
      source_url: `https://d-nb.info/gnd/${gnd}`,
    };
  });
  const upsertedArtists = await chunkedUpsert(
    supabase,
    "artists",
    artistRows as unknown as Record<string, unknown>[],
    "id,source_id",
  );
  const artistIdBySourceId = new Map<string, string>(
    upsertedArtists.map((row) => [row.source_id as string, row.id as string]),
  );
  console.log(`[ingest:staedel] upserted ${upsertedArtists.length} artists`);

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
  console.log(`[ingest:staedel] upserted ${upsertedArtworks.length} artworks`);
  console.log(
    "[ingest:staedel] done. Run `pnpm dedup` to fold cross-source duplicates.",
  );
}

main().catch((err: unknown) => {
  console.error(
    "[ingest:staedel] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
