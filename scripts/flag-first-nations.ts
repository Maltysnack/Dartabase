// Conservative ICIP flagging, run after every ingestion and before export.
//
//   pnpm flag:icip            (dry run: prints counts)
//   pnpm flag:icip -- --apply
//
// Wikidata records an artist's ethnic group for only some First Nations
// artists, so ingestion alone misses many. This adds three more signals, all
// of which only ever set cultural_notice to true (never clear it):
//   1. any artist who already has a flagged work (e.g. from a QAGOMA
//      Indigenous Australian Art department record) has all their works flagged;
//   2. the artist's name carries a Western Desert, Warlpiri, Yolngu or Tiwi
//      skin or clan name;
//   3. the title names a Dreaming or Tjukurrpa.
// It is a safety net, not a classification: records it misses are still
// covered by the standing advisory on every page and the per-record takedown
// link. Local database only.

import { execFileSync } from "node:child_process";

const CONTAINER = process.env.DB_CONTAINER ?? "supabase_db_Dartabase";
const apply = process.argv.includes("--apply");

const NAMES = [
  // Western Desert, Warlpiri, Anmatyerre and Pitjantjatjara skin names
  "napaltjarri", "napangardi", "napanangka", "nampijinpa", "nungurrayi", "nangala", "napurrurla",
  "napaljarri", "nakamarra", "nampitjinpa", "napurrula", "tjapaltjarri", "tjampitjinpa", "tjakamarra",
  "tjapangati", "tjangala", "tjupurrula", "tjungurrayi", "japaljarri", "japanangka", "jampijinpa",
  "jakamarra", "jangala", "japangardi", "jupurrurla", "jungarrayi", "jagamara", "jabaljari",
  "petyarre", "kngwarreye", "pwerle", "ngale", "kemarre", "mpetyane",
  // Yolngu and Arnhem Land clan names
  "yunupingu", "marawili", "gumana", "mununggurr", "burarrwanga", "ngulmarmar", "wanambi",
  "mununggiritj", "garrawurra", "djambawa", "gurruwiwi", "ganambarr", "maymuru", "wirrpanda",
  // Tiwi
  "puruntatameri", "orsto", "kerinaiua",
];
const nameRe = `\\m(${NAMES.join("|")})\\M`;
const titleRe = "\\m(dreaming|tjukurrpa|jukurrpa|tingarri)\\M";

function psql(sql: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-At", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

const before = psql("select count(*) from artworks where cultural_notice");
const steps: [string, string][] = [
  [
    "artists with a flagged work",
    `update artworks set cultural_notice = true where not cultural_notice and artist_id in (select distinct artist_id from artworks where cultural_notice and artist_id is not null)`,
  ],
  [
    "skin and clan names",
    `update artworks set cultural_notice = true where not cultural_notice and artist_id in (select id from artists where lower(name) ~ '${nameRe}')`,
  ],
  ["Dreaming titles", `update artworks set cultural_notice = true where not cultural_notice and lower(title) ~ '${titleRe}'`],
];

for (const [label, sql] of steps) {
  if (apply) {
    console.log(`${label}: ${psql(sql)}`);
  } else {
    const count = psql(sql.replace(/^update artworks set cultural_notice = true where/, "select count(*) from artworks where"));
    console.log(`${label}: would flag ${count}`);
  }
}
console.log(`flagged before: ${before}, after: ${psql("select count(*) from artworks where cultural_notice")}`);
if (!apply) console.log("dry run; pass --apply to write");
