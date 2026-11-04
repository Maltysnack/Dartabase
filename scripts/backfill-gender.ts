// Backfill artists.gender from Wikidata P21 (sex or gender).
//
// Reads every canonical artist with a wikidata_id and a null gender, queries
// Wikidata in batches for P21, then maps the returned entity IDs to
// 'female', 'male', or 'non-binary' and writes back.
//
// Gender QID mapping (see Wikidata docs for P21):
//   Q6581072  female
//   Q6581097  male
//   Q1052281  transgender woman -> female
//   Q2449503  transgender man   -> male
//   Q48270    non-binary
//   Q12964198 genderqueer       -> non-binary
//   Q301702   androgyne         -> non-binary
//
// All other P21 values (e.g. Q179294 intersex, Q2333684 not applicable) are
// skipped; the gender column stays null for those artists.
//
// Run:  pnpm exec tsx scripts/backfill-gender.ts
//       add --dry-run to preview without writing.

import { createAdminClient } from "./lib/supabase-admin";

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "Dartabase/0.1 (art reference aggregator; +https://github.com/Maltysnack/Dartabase)";
const BATCH_SIZE = 50;
const DELAY_MS = 800;

type GenderValue = "female" | "male" | "non-binary";

const GENDER_MAP: Record<string, GenderValue> = {
  Q6581072: "female",
  Q6581097: "male",
  Q1052281: "female",  // transgender woman
  Q2449503: "male",    // transgender man
  Q48270: "non-binary",
  Q12964198: "non-binary",  // genderqueer
  Q301702: "non-binary",    // androgyne
};

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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface Binding {
  item?: { value: string };
  gender?: { value: string };
}

function sparqlQuery(qids: string[]): string {
  const values = qids.map((q) => `wd:${q}`).join(" ");
  return `SELECT ?item ?gender WHERE {
  VALUES ?item { ${values} }
  ?item wdt:P21 ?gender .
}`;
}

async function runSparql(query: string): Promise<Binding[]> {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/sparql-results+json",
    },
  });
  if (!res.ok) throw new Error(`Wikidata SPARQL ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { results: { bindings: Binding[] } };
  return json.results.bindings;
}

function extractQid(entityUrl: string): string {
  return entityUrl.split("/").pop() ?? "";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("artists")
    .select("id,name,wikidata_id")
    .not("wikidata_id", "is", null)
    .is("gender", null)
    .is("merged_into", null);
  if (error) throw error;

  const candidates = (data ?? []) as { id: string; name: string; wikidata_id: string }[];
  console.log(
    `[backfill:gender] ${args.dryRun ? "DRY RUN" : "APPLY"}: ` +
      `${candidates.length} artists with wikidata_id and null gender`,
  );
  if (candidates.length === 0) return;

  const idByQid = new Map<string, string>();
  for (const row of candidates) idByQid.set(row.wikidata_id, row.id);

  const qids = [...idByQid.keys()];
  const found = new Map<string, GenderValue>();

  for (let i = 0; i < qids.length; i += BATCH_SIZE) {
    const batch = qids.slice(i, i + BATCH_SIZE);
    process.stdout.write(
      `[backfill:gender]   batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(qids.length / BATCH_SIZE)} (${batch.length} qids)... `,
    );
    try {
      const bindings = await runSparql(sparqlQuery(batch));
      let hits = 0;
      for (const row of bindings) {
        if (!row.item?.value || !row.gender?.value) continue;
        const qid = extractQid(row.item.value);
        const genderQid = extractQid(row.gender.value);
        const mapped = GENDER_MAP[genderQid];
        if (!mapped) continue;
        // Last value wins if there are multiple P21 values -- female/male take
        // priority over non-binary to avoid data noise from stub records.
        const existing = found.get(qid);
        if (!existing || mapped !== "non-binary") found.set(qid, mapped);
        hits++;
      }
      console.log(`${hits} hits`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)} (skipping batch)`);
    }
    if (i + BATCH_SIZE < qids.length) await sleep(DELAY_MS);
  }

  console.log(`\n[backfill:gender] resolved ${found.size} / ${qids.length} artists`);

  if (args.dryRun) {
    for (const [qid, gender] of found) {
      const id = idByQid.get(qid);
      const row = candidates.find((c) => c.id === id);
      console.log(`  ${row?.name ?? id}: ${gender}`);
    }
    return;
  }

  let written = 0;
  for (const [qid, gender] of found) {
    const id = idByQid.get(qid);
    if (!id) continue;
    const { error: upErr } = await supabase
      .from("artists")
      .update({ gender })
      .eq("id", id);
    if (upErr) {
      console.error(`  ${id}: ${upErr.message}`);
    } else {
      written++;
    }
  }
  console.log(`[backfill:gender] wrote ${written} rows`);
}

main().catch((err: unknown) => {
  console.error("[backfill:gender] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
