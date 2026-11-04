// One-time backfill: generates slug values for all artists and artworks that
// have none. Safe to re-run; rows with an existing slug are skipped.
//
// Run after applying migration 0019_slugs.sql:
//   pnpm backfill:slugs
//
// Collision strategy: if a candidate slug is already taken, append -2, -3, ...
// until a free slot is found. Slugs are immutable once set, so subsequent
// runs produce no changes.

import { createAdminClient } from "./lib/supabase-admin";
import { artistSlug, artworkSlug } from "./lib/slug";

async function loadExistingSlugs(
  supabase: ReturnType<typeof createAdminClient>,
  table: "artists" | "artworks",
): Promise<Set<string>> {
  const pageSize = 1000;
  const seen = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("slug")
      .not("slug", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as { slug: string }[];
    for (const r of rows) seen.add(r.slug);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return seen;
}

const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");

function log(...args: unknown[]) {
  if (VERBOSE) console.log(...args);
}

// Returns a slug that does not collide with any value in the seen set.
// On collision appends -2, -3, etc.
function uniqueSlug(base: string, seen: Set<string>): string {
  if (!seen.has(base)) return base;
  let n = 2;
  while (seen.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

async function backfillArtists() {
  const supabase = createAdminClient();

  // Fetch all artists without a slug (and their names for generation).
  const { data: artists, error } = await supabase
    .from("artists")
    .select("id,name")
    .is("slug", null)
    .is("merged_into", null)
    .order("created_at");
  if (error) throw error;
  if (!artists || artists.length === 0) {
    console.log("artists: nothing to backfill");
    return;
  }

  const seen = await loadExistingSlugs(supabase, "artists");

  let updated = 0;
  for (const artist of artists as { id: string; name: string }[]) {
    const base = artistSlug(artist.name);
    if (!base) {
      log(`  artists: skipping ${artist.id} (empty slug base from "${artist.name}")`);
      continue;
    }
    const slug = uniqueSlug(base, seen);
    seen.add(slug);
    log(`  artists: ${artist.name} -> ${slug}`);
    if (!DRY_RUN) {
      const { error: upErr } = await supabase
        .from("artists")
        .update({ slug })
        .eq("id", artist.id);
      if (upErr) {
        console.error(`  artists: failed to update ${artist.id}:`, upErr.message);
        continue;
      }
    }
    updated++;
  }

  console.log(
    `artists: ${DRY_RUN ? "(dry-run) would update" : "updated"} ${updated} / ${artists.length}`,
  );
}

async function backfillArtworks() {
  const supabase = createAdminClient();

  // Fetch all artworks without a slug along with artist name and year.
  const { data: artworks, error } = await supabase
    .from("artworks")
    .select("id,title,date_year,artist:artist_id(name)")
    .is("slug", null)
    .order("created_at");
  if (error) throw error;
  if (!artworks || artworks.length === 0) {
    console.log("artworks: nothing to backfill");
    return;
  }

  const seen = await loadExistingSlugs(supabase, "artworks");

  let updated = 0;
  for (const artwork of artworks as unknown as {
    id: string;
    title: string;
    date_year: number | null;
    artist: { name: string } | null;
  }[]) {
    const base = artworkSlug(
      artwork.title,
      artwork.artist?.name ?? null,
      artwork.date_year,
    );
    if (!base) {
      log(`  artworks: skipping ${artwork.id} (empty slug base)`);
      continue;
    }
    const slug = uniqueSlug(base, seen);
    seen.add(slug);
    log(`  artworks: "${artwork.title}" -> ${slug}`);
    if (!DRY_RUN) {
      const { error: upErr } = await supabase
        .from("artworks")
        .update({ slug })
        .eq("id", artwork.id);
      if (upErr) {
        console.error(`  artworks: failed to update ${artwork.id}:`, upErr.message);
        continue;
      }
    }
    updated++;
  }

  console.log(
    `artworks: ${DRY_RUN ? "(dry-run) would update" : "updated"} ${updated} / ${artworks.length}`,
  );
}

async function main() {
  console.log(DRY_RUN ? "dry run: no writes" : "backfilling slugs...");
  await backfillArtists();
  await backfillArtworks();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
