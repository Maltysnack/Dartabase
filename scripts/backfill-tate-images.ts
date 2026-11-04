// Backfill image_url for Tate artworks via Wikidata/Wikimedia Commons.
//
// The Tate CC0 CSV dump includes thumbnail URLs for most works, but ~278
// records have no image in the source data. Many Tate CC0 works are also
// mirrored on Wikimedia Commons and catalogued in Wikidata with their
// accession number (P217) and image (P18).
//
// This script:
//   1. Queries Wikidata SPARQL for items held at Tate (Q430682) that
//      have both a P217 inventory number and a P18 image.
//   2. Matches those accession numbers against the source_id values of
//      Tate artworks in our DB that currently have no image.
//   3. Updates image_url (and image_license) for every match.
//
// Wikimedia Commons Special:FilePath URLs serve display-sized copies when
// given a ?width= parameter and work from the browser with no auth.
//
// Usage:
//   pnpm backfill:tate-images [--dry-run] [--verbose]

import { createAdminClient } from "./lib/supabase-admin";

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "Dartabase/0.1 (art reference aggregator; +https://github.com/Maltysnack/Dartabase)";

const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");

// Wikidata Q430682 = Tate (the umbrella institution covering Tate Modern,
// Tate Britain, Tate Liverpool, and Tate St Ives).
const TATE_QID = "Q430682";

function commonsImageUrl(rawSparqlUrl: string): string {
  const https = rawSparqlUrl.replace(/^http:/, "https:");
  return `${https}${https.includes("?") ? "&" : "?"}width=800`;
}

interface Binding {
  [key: string]: { value: string } | undefined;
}

async function fetchWikidataImages(): Promise<Map<string, string>> {
  // P195 = collection, P276 = location, P217 = inventory number, P18 = image.
  // UNION covers items catalogued under either property for Tate.
  const query = `
SELECT DISTINCT ?inventoryNumber ?image WHERE {
  {
    ?item wdt:P195 wd:${TATE_QID} .
  } UNION {
    ?item wdt:P276 wd:${TATE_QID} .
  }
  ?item wdt:P18 ?image ;
        wdt:P217 ?inventoryNumber .
}
`;

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
  const bindings = json.results.bindings;

  const map = new Map<string, string>();
  for (const b of bindings) {
    const accession = b.inventoryNumber?.value?.trim();
    const image = b.image?.value;
    if (!accession || !image) continue;
    if (!map.has(accession)) {
      map.set(accession, commonsImageUrl(image));
    }
  }
  return map;
}

async function main(): Promise<void> {
  console.log(`[backfill:tate-images] ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  console.log("[backfill:tate-images] querying Wikidata SPARQL...");
  const wikidataImages = await fetchWikidataImages();
  console.log(
    `[backfill:tate-images] Wikidata: ${wikidataImages.size} accession numbers with images`,
  );

  if (wikidataImages.size === 0) {
    console.log("[backfill:tate-images] no Wikidata images found, exiting");
    return;
  }

  const supabase = createAdminClient();

  const { data: rows, error } = await supabase
    .from("artworks")
    .select("id,source_id,title")
    .eq("source", "tate")
    .is("image_url", null);

  if (error) throw new Error(`fetch artworks: ${error.message}`);
  const artworks = (rows ?? []) as { id: string; source_id: string; title: string }[];
  console.log(
    `[backfill:tate-images] ${artworks.length} Tate artworks currently have no image`,
  );

  const updates: { id: string; source_id: string; title: string; imageUrl: string }[] = [];
  for (const artwork of artworks) {
    const imageUrl = wikidataImages.get(artwork.source_id.trim());
    if (imageUrl) {
      updates.push({ ...artwork, imageUrl });
    }
  }

  console.log(`[backfill:tate-images] ${updates.length} matches found`);

  if (VERBOSE) {
    for (const u of updates.slice(0, 10)) {
      console.log(`  ${u.source_id}: "${u.title}" -> ${u.imageUrl}`);
    }
    if (updates.length > 10) {
      console.log(`  ... and ${updates.length - 10} more`);
    }
  }

  if (DRY_RUN) {
    console.log("[backfill:tate-images] DRY RUN: no DB writes performed");
    return;
  }

  if (updates.length === 0) {
    console.log("[backfill:tate-images] nothing to update");
    return;
  }

  const BATCH = 100;
  let updated = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    for (const u of chunk) {
      const { error: updateError } = await supabase
        .from("artworks")
        .update({
          image_url: u.imageUrl,
          image_license: "Wikimedia Commons (see source)",
        })
        .eq("id", u.id);
      if (updateError) {
        console.error(`  ERROR updating ${u.source_id}: ${updateError.message}`);
      } else {
        updated++;
        if (VERBOSE) {
          console.log(`  updated ${u.source_id}: "${u.title}"`);
        }
      }
    }
    console.log(
      `[backfill:tate-images] updated ${Math.min(i + BATCH, updates.length)} / ${updates.length}`,
    );
  }

  console.log(`[backfill:tate-images] done: ${updated} records updated`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
