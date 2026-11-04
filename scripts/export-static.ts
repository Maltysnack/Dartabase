// Writes the static data the site reads (public/data) from the local database.
//
//   pnpm export
//
// Needs the local Supabase stack running with the corpus loaded (see README).
// Everything the public site shows is decided here: images are kept only where
// the source has openly licensed them, and First Nations flags are carried
// through. The site itself has no server and no database.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { idKey, tokenKey, tokens, type SearchArtist, type SearchArtwork } from "../src/lib/shard";

const OUT = join(process.cwd(), "public", "data");
const CONTAINER = process.env.DB_CONTAINER ?? "supabase_db_Dartabase";
const MAX_POSTINGS = 400; // entries kept per search token
const MAX_SITE_MB = 900; // GitHub Pages allows 1 GB

// An image is shown only where the source has openly licensed it. Commons
// files are free by definition; "see source", rights-reserved and bare
// institution names are dropped (the record then links to the source).
export function isOpenImageLicence(licence: string | null): boolean {
  if (!licence) return false;
  if (/wikimedia commons/i.test(licence)) return true;
  if (/rights reserved|©|dacs|see source|^tate$/i.test(licence)) return false;
  return /cc0|public domain|no known copyright|cc by|open access/i.test(licence);
}

// Commons serves the full-resolution file unless a width is given.
const withWidth = (url: string) => (url.includes("?") ? url : `${url}?width=480`);

async function rows<T>(sql: string): Promise<T[]> {
  const p = spawn("docker", [
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-At", "-c",
    `select row_to_json(t) from (${sql}) t`,
  ]);
  const out: T[] = [];
  const rl = createInterface({ input: p.stdout });
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  for await (const line of rl) if (line) out.push(JSON.parse(line) as T);
  const code: number = await new Promise((r) => p.on("close", r));
  if (code !== 0) throw new Error(`psql failed: ${err}`);
  return out;
}

interface DbInstitution {
  id: string; name: string; city: string | null; country: string | null;
  website: string | null; merged_into: string | null;
}
interface DbArtist {
  id: string; name: string; sort_name: string | null; also_known_as: string[];
  birth_year: number | null; death_year: number | null; nationality: string | null;
  image_url: string | null; wikidata_id: string | null; merged_into: string | null;
}
interface DbArtwork {
  id: string; title: string; artist_id: string | null; date_text: string | null;
  date_year: number | null; medium: string | null; dimensions: string | null;
  current_institution_id: string | null; credit_line: string | null;
  image_url: string | null; image_license: string | null; source: string;
  source_id: string | null; source_url: string | null; cultural_notice: boolean;
  cultural_attribution: string | null; classification: string | null;
}

function writeShards(dir: string, shards: Map<string, unknown>) {
  mkdirSync(join(OUT, dir), { recursive: true });
  for (const [key, value] of shards) {
    writeFileSync(join(OUT, dir, `${key}.json`), JSON.stringify(value));
  }
}

function dirMb(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    total += name.isDirectory() ? dirMb(p) * 1024 * 1024 : statSync(p).size;
  }
  return total / 1024 / 1024;
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const institutions = await rows<DbInstitution>(
    "select id,name,city,country,website,merged_into from institutions",
  );
  const artists = await rows<DbArtist>(
    "select id,name,sort_name,also_known_as,birth_year,death_year,nationality,image_url,wikidata_id,merged_into from artists",
  );
  const artworks = await rows<DbArtwork>(
    "select id,title,artist_id,date_text,date_year,medium,dimensions,current_institution_id,credit_line,image_url,image_license,source,source_id,source_url,cultural_notice,cultural_attribution,classification from artworks where title is not null and title <> ''",
  );
  console.log(`read ${artworks.length} artworks, ${artists.length} artists, ${institutions.length} institutions`);

  // Follow merge chains so every reference lands on a surviving record.
  const instById = new Map(institutions.map((i) => [i.id, i]));
  const artistById = new Map(artists.map((a) => [a.id, a]));
  const resolve = <T extends { id: string; merged_into: string | null }>(
    map: Map<string, T>, id: string | null,
  ): T | null => {
    let cur = id ? map.get(id) : undefined;
    for (let i = 0; cur?.merged_into && i < 10; i++) cur = map.get(cur.merged_into);
    return cur && !cur.merged_into ? cur : null;
  };

  let droppedImages = 0;
  const recordsByShard = new Map<string, Record<string, unknown>>();
  const searchWorks = new Map<string, Map<string, { e: SearchArtwork; rank: number }[]>>();
  const worksByArtist = new Map<string, unknown[][]>();
  const instCounts = new Map<string, { n: number; images: number }>();
  const featuredPool: { id: string; inst: string; h: number }[] = [];

  for (const w of artworks) {
    const inst = resolve(instById, w.current_institution_id);
    const artist = resolve(artistById, w.artist_id);
    const open = w.image_url && isOpenImageLicence(w.image_license);
    if (w.image_url && !open) droppedImages++;
    const image = open ? w.image_url : null;
    const date = w.date_text ?? (w.date_year != null ? String(w.date_year) : null);

    const rec = {
      id: w.id, title: w.title,
      artist: artist ? { id: artist.id, name: artist.name, sort: artist.sort_name, birth: artist.birth_year, death: artist.death_year } : null,
      date, year: w.date_year, medium: w.medium, dimensions: w.dimensions,
      institution: inst ? { name: inst.name, city: inst.city, website: inst.website } : null,
      credit: w.credit_line, image, licence: image ? w.image_license : null,
      source: w.source, sourceId: w.source_id, sourceUrl: w.source_url,
      icip: w.cultural_notice || undefined, attribution: w.cultural_attribution ?? undefined,
      classification: w.classification,
    };
    const key = idKey(w.id);
    const shard = recordsByShard.get(key) ?? {};
    shard[w.id] = rec;
    recordsByShard.set(key, shard);

    if (inst) {
      const c = instCounts.get(inst.id) ?? { n: 0, images: 0 };
      c.n++; if (image) c.images++;
      instCounts.set(inst.id, c);
    }
    if (artist) {
      const list = worksByArtist.get(artist.id) ?? [];
      list.push([w.id, w.title, date, w.date_year, inst?.name ?? null, image ? 1 : 0]);
      worksByArtist.set(artist.id, list);
    }
    // Search entry, stored once per token, best-ranked kept per token.
    const entry: SearchArtwork = [w.id, w.title, artist?.name ?? null, w.date_year, image ? 1 : 0];
    const rank = (image ? 2 : 0) + (artist ? 1 : 0);
    for (const t of tokens(`${w.title} ${artist?.name ?? ""}`)) {
      const k = tokenKey(t);
      const shardMap = searchWorks.get(k) ?? new Map();
      const list = shardMap.get(t) ?? [];
      list.push({ e: entry, rank });
      shardMap.set(t, list);
      searchWorks.set(k, shardMap);
    }
    if (image && !w.cultural_notice && inst) {
      let h = 0;
      for (const ch of w.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      featuredPool.push({ id: w.id, inst: inst.name, h });
    }
  }
  console.log(`dropped ${droppedImages} images without an open licence`);

  writeShards("w", recordsByShard);

  const searchWorkOut = new Map<string, Record<string, SearchArtwork[]>>();
  for (const [k, tokenMap] of searchWorks) {
    const obj: Record<string, SearchArtwork[]> = {};
    for (const [t, list] of tokenMap) {
      list.sort((a, b) => b.rank - a.rank);
      obj[t] = list.slice(0, MAX_POSTINGS).map((x) => x.e);
    }
    searchWorkOut.set(k, obj);
  }
  writeShards("sw", searchWorkOut);

  // Artists: only those with works, and not placeholder attributions.
  const artistShards = new Map<string, Record<string, unknown>>();
  const searchArtists = new Map<string, Record<string, SearchArtist[]>>();
  let artistCount = 0;
  for (const a of artists) {
    if (a.merged_into) continue;
    const works = worksByArtist.get(a.id);
    if (!works || works.length === 0) continue;
    if (/^(unknown|unidentified|anonymous)/i.test(a.name.trim())) continue;
    works.sort((x, y) => ((x[3] as number | null) ?? 9999) - ((y[3] as number | null) ?? 9999));
    const key = idKey(a.id);
    const shard = artistShards.get(key) ?? {};
    shard[a.id] = {
      id: a.id, name: a.name, aka: a.also_known_as.slice(0, 4), birth: a.birth_year,
      death: a.death_year, nationality: a.nationality,
      image: a.image_url && /commons\.wikimedia\.org/.test(a.image_url) ? withWidth(a.image_url) : null,
      wikidata: a.wikidata_id, works,
    };
    artistShards.set(key, shard);
    artistCount++;
    const entry: SearchArtist = [a.id, a.name, a.birth_year, a.death_year, a.nationality, works.length];
    for (const t of tokens([a.name, ...a.also_known_as.slice(0, 4)].join(" "))) {
      const k = tokenKey(t);
      const obj = searchArtists.get(k) ?? {};
      (obj[t] ??= []).push(entry);
      searchArtists.set(k, obj);
    }
  }
  for (const obj of searchArtists.values()) {
    for (const t of Object.keys(obj)) {
      obj[t].sort((x, y) => y[5] - x[5]);
      obj[t] = obj[t].slice(0, MAX_POSTINGS);
    }
  }
  writeShards("ar", artistShards);
  writeShards("sa", searchArtists);

  // Home page wall: one work per institution first, then fill, stable order.
  featuredPool.sort((a, b) => a.h - b.h);
  const seenInst = new Set<string>();
  const featured: string[] = [];
  for (const f of featuredPool) {
    if (seenInst.has(f.inst)) continue;
    seenInst.add(f.inst); featured.push(f.id);
    if (featured.length >= 24) break;
  }
  const featuredRecords = featured.map((id) => (recordsByShard.get(idKey(id)) as Record<string, unknown>)[id]);
  writeFileSync(join(OUT, "featured.json"), JSON.stringify(featuredRecords));

  const insts = [...instCounts.entries()]
    .map(([id, c]) => {
      const i = instById.get(id)!;
      return { name: i.name, city: i.city, country: i.country, website: i.website, works: c.n, images: c.images };
    })
    .sort((a, b) => b.works - a.works);
  writeFileSync(join(OUT, "institutions.json"), JSON.stringify(insts));

  const stats = { artworks: artworks.length, artists: artistCount, institutions: insts.length, built: new Date().toISOString().slice(0, 10) };
  writeFileSync(join(OUT, "stats.json"), JSON.stringify(stats));

  const mb = dirMb(OUT);
  console.log(`wrote public/data: ${mb.toFixed(1)} MB`, stats);
  if (mb > MAX_SITE_MB) throw new Error(`data is ${mb.toFixed(0)} MB, over the ${MAX_SITE_MB} MB budget`);
}

main().catch((e) => { console.error(e); process.exit(1); });
