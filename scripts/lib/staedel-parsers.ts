// Städel-specific text parsers used by scripts/ingest-staedel.ts.
// Extracted to a side-effect-free module so they can be unit-tested without
// importing the adapter file (which runs main() at the bottom on import).
// Same pattern as scripts/lib/{mia,harvard}-parsers.ts.

// LIDO actor records arrive in either "Forename Surname" or
// "Surname, Forename" order, depending on the cataloguer's convention.
// Flip the second form so downstream code (dedup, display, citation) sees a
// uniform "Forename Surname" name.
export function flipSurnameFirst(name: string): string {
  const trimmed = name.trim();
  if (!trimmed.includes(", ")) return trimmed;
  const [last, first] = trimmed.split(", ", 2);
  return `${first} ${last}`.trim();
}
