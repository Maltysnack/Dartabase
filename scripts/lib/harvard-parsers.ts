// Harvard-specific text parsers used by scripts/ingest-harvard.ts.
//
// Extracted to a side-effect-free module so they can be unit-tested without
// importing the adapter file (which runs main() at the bottom on import).
// Same pattern as scripts/lib/mia-parsers.ts and scripts/lib/year.ts.

// Harvard person life dates arrive as a freeform display string, e.g.
// "1853 - 1890", or just "1853" if only birth is known, or "b. 1853"
// for living artists. Extracts the first 1-2 four-digit runs as
// (birth_year, death_year). These feed both the artist record and one
// of the three dedup union-find keys, so getting the parse right
// affects cross-source artist canonicalisation.
export function lifeYears(displaydate: string | undefined | null): {
  birth: number | null;
  death: number | null;
} {
  if (!displaydate) return { birth: null, death: null };
  const nums = displaydate.match(/\d{3,4}/g);
  if (!nums) return { birth: null, death: null };
  return {
    birth: Number(nums[0]),
    death: nums[1] ? Number(nums[1]) : null,
  };
}
