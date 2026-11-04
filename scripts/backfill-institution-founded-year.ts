// Backfill institutions.founded_year from Wikidata (P571 = inception).
//
// Reads every institution with a wikidata_id and a null founded_year, asks
// Wikidata for the inception year in batches, and writes the result back.
// Idempotent: already-populated rows are skipped, and the SPARQL is keyed on
// the QID so a re-run only fills in the gaps.
//
// Run: pnpm exec tsx scripts/backfill-institution-founded-year.ts
//      add --dry-run to preview without writing.

import { createAdminClient } from "./lib/supabase-admin";

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "Dartabase/0.1 (art reference aggregator; +https://github.com/Maltysnack/Dartabase)";
const BATCH_SIZE = 50;

interface Args {
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--") continue;
    else if (arg === "--dry-run") dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { dryRun };
}

function sparql(qids: string[]): string {
  const values = qids.map((q) => `wd:${q}`).join(" ");
  // Some institutions carry multiple P571 values (a parent body's inception
  // plus the museum's). SAMPLE picks any one; pair with a small post-filter
  // that rejects implausible years.
  return `
SELECT ?item (SAMPLE(?inception) AS ?inception) WHERE {
  VALUES ?item { ${values} }
  ?item wdt:P571 ?inception .
}
GROUP BY ?item`;
}

interface Binding {
  item?: { value: string };
  inception?: { value: string };
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

function yearOf(isoDate: string): number | null {
  // ISO date may be "+1879-01-01T00:00:00Z" or "-0500-..."; pull the year.
  const match = isoDate.match(/^([+-]?\d+)/);
  if (!match) return null;
  const year = Number(match[1]);
  if (!Number.isFinite(year)) return null;
  if (year < 1000 || year > new Date().getFullYear()) {
    // Museums founded before 1000 CE essentially do not exist as our
    // schema models them; future-dated inception is data noise.
    return null;
  }
  return year;
}

function qid(entityUrl: string): string {
  return entityUrl.split("/").pop() ?? entityUrl;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("institutions")
    .select("id,name,wikidata_id")
    .not("wikidata_id", "is", null)
    .is("founded_year", null);
  if (error) throw error;

  const candidates = (data ?? []) as {
    id: string;
    name: string;
    wikidata_id: string;
  }[];

  console.log(
    `[backfill] ${args.dryRun ? "DRY RUN" : "APPLY"}: ` +
      `${candidates.length} institutions with wikidata_id and null founded_year`,
  );
  if (candidates.length === 0) return;

  const idByQid = new Map<string, string>();
  for (const row of candidates) idByQid.set(row.wikidata_id, row.id);

  const qids = [...idByQid.keys()];
  const found = new Map<string, number>();

  for (let i = 0; i < qids.length; i += BATCH_SIZE) {
    const batch = qids.slice(i, i + BATCH_SIZE);
    process.stdout.write(
      `[backfill]   batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} qids)... `,
    );
    try {
      const bindings = await runSparql(sparql(batch));
      let hits = 0;
      for (const row of bindings) {
        const item = row.item?.value;
        const inception = row.inception?.value;
        if (!item || !inception) continue;
        const year = yearOf(inception);
        if (year == null) continue;
        found.set(qid(item), year);
        hits += 1;
      }
      console.log(`${hits} hits`);
    } catch (err) {
      console.log(
        `FAILED: ${err instanceof Error ? err.message : String(err)} (skipping batch)`,
      );
    }
  }

  console.log(`\n[backfill] resolved ${found.size} / ${qids.length} institutions`);
  if (args.dryRun) {
    for (const [q, year] of found) {
      const id = idByQid.get(q);
      const row = candidates.find((c) => c.id === id);
      console.log(`  ${row?.name ?? id}: ${year}`);
    }
    return;
  }

  let written = 0;
  for (const [q, year] of found) {
    const id = idByQid.get(q);
    if (!id) continue;
    const { error: upErr } = await supabase
      .from("institutions")
      .update({ founded_year: year })
      .eq("id", id);
    if (upErr) {
      console.error(`  ${id}: ${upErr.message}`);
    } else {
      written += 1;
    }
  }
  console.log(`[backfill] wrote ${written} rows`);
}

main().catch((err: unknown) => {
  console.error(
    "[backfill] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
