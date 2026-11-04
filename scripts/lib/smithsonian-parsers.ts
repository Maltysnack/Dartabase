// Smithsonian-specific text parsers used by scripts/ingest-smithsonian.ts.
// Extracted to a side-effect-free module so they can be unit-tested without
// importing the adapter file (which runs main() at the bottom on import).
// Same pattern as scripts/lib/{mia,harvard,staedel}-parsers.ts.

// Derive a stable slug from a display name. Smithsonian (and MIA) don't
// expose a stable person identifier, so the adapter manufactures one. The
// implementation is intentionally identical to MIA's so dedup similarity
// matching produces the same slug on both sides of a cross-source merge.
// Worth consolidating into a shared scripts/lib/slug.ts if a third caller
// arrives.
export function artistSourceIdFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Smithsonian artist strings pack life data into one line, with conventions
// that vary across the seven art units. Examples:
//   "Arthur A. Marschner, born Detroit, MI 1884-died Detroit, MI 1950"
//   "Albrecht Dürer, German, b. Nuremberg, 1471–1528"
//   "Pablo Picasso, Spanish, 1881-1973"
//   "Unknown"
//
// Extracts:
//   name        - everything before the first comma (or the whole string)
//   birth, death - the first two 3-4 digit runs anywhere in the string
//   nationality  - the chunk immediately after the first comma, IF it looks
//                  like a demonym (a single capitalised word that doesn't
//                  start a "born"/"died"/"b."/"d."/"ca"/"circa" token)
export function parseArtistField(raw: string): {
  name: string;
  birth: number | null;
  death: number | null;
  nationality: string | null;
} {
  const trimmed = raw.trim();
  const firstComma = trimmed.indexOf(",");
  const name = firstComma === -1 ? trimmed : trimmed.slice(0, firstComma).trim();

  const years = trimmed.match(/\d{3,4}/g) ?? [];
  const birth = years[0] ? Number(years[0]) : null;
  const death = years[1] ? Number(years[1]) : null;

  // Look at the chunk after the first comma; if it's a single capitalised
  // word that doesn't start a "born"/"b."/"died"/"d." token, treat it as
  // the nationality. Defensive: a chunk like "born Detroit" is not a
  // nationality.
  let nationality: string | null = null;
  if (firstComma !== -1) {
    const after = trimmed.slice(firstComma + 1);
    const nextChunk = after.split(",")[0]?.trim() ?? "";
    if (
      /^[A-Z][A-Za-z\-/]+$/.test(nextChunk) &&
      !/^(born|died|b\.|d\.|ca|circa|active|fl)\b/i.test(nextChunk)
    ) {
      nationality = nextChunk;
    }
  }
  return { name, birth, death, nationality };
}
