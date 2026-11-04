// One-time script to null out artist_id on artworks that reference
// placeholder "Unknown" / "Unidentified" / "Anonymous" artist rows,
// then delete those rows from the artists table.
//
// Entries like "Anonymous, German, 18th century" are kept -- they carry
// real cultural/period attribution. Only bare placeholder names are removed.
//
// Safe to re-run: already-deleted rows just produce a no-op.
//
// Usage:
//   pnpm exec tsx scripts/consolidate-unknown-artists.ts -- --dry-run
//   pnpm exec tsx scripts/consolidate-unknown-artists.ts

import { createAdminClient } from "./lib/supabase-admin";

const PLACEHOLDER_NAMES = new Set([
  "Unknown",
  "UNKNOWN",
  "Unknown artist",
  "Unknown Maker",
  "UNKNOWN CABINETMAKER",
  "Unidentified Artist",
  "Unidentified Artists",
  "Anonymous",
  "Anonymous Artist",
]);

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[consolidate-unknown] ${dryRun ? "DRY RUN" : "LIVE"}`);

  const sb = createAdminClient();

  // Find matching artist rows by name directly.
  const { data: rows, error } = await sb
    .from("artists")
    .select("id, name, source")
    .is("merged_into", null)
    .in("name", [...PLACEHOLDER_NAMES]);
  if (error) throw new Error(error.message);

  const targets = rows ?? [];
  console.log(`[consolidate-unknown] found ${targets.length} placeholder artist rows`);

  let totalArtworks = 0;
  for (const artist of targets) {
    const { count } = await sb
      .from("artworks")
      .select("id", { count: "exact", head: true })
      .eq("artist_id", artist.id);
    totalArtworks += count ?? 0;
    console.log(
      `  [${artist.source}] "${artist.name}" - ${count} artworks`,
    );
  }
  console.log(`[consolidate-unknown] total artworks to repoint: ${totalArtworks}`);

  if (dryRun) {
    console.log("[consolidate-unknown] DRY RUN: no changes written.");
    return;
  }

  let nulled = 0;
  let deleted = 0;
  for (const artist of targets) {
    // Null out artist_id on affected artworks.
    const { error: artErr, count: artCount } = await sb
      .from("artworks")
      .update({ artist_id: null })
      .eq("artist_id", artist.id);
    if (artErr) throw new Error(`null artist on artworks: ${artErr.message}`);
    nulled += artCount ?? 0;

    // Delete the placeholder artist row.
    const { error: delErr } = await sb
      .from("artists")
      .delete()
      .eq("id", artist.id);
    if (delErr) throw new Error(`delete artist: ${delErr.message}`);
    deleted++;
  }

  console.log(
    `[consolidate-unknown] done: ${nulled} artworks nulled, ${deleted} artist rows deleted.`,
  );
}

main().catch((err: unknown) => {
  console.error(
    "[consolidate-unknown] FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
