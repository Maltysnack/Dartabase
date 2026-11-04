// MIA-specific text parsers used by scripts/ingest-mia.ts.
//
// Extracted to a side-effect-free module so they can be unit-tested without
// importing the adapter file (which runs main() at the bottom and would
// trigger a full ingestion). Three parsers, all pure:
//
//  - primaryArtistName: Mia's creator field is either a clean name or a
//    semicolon-joined "artist: Name" list. Returns the first listed maker.
//
//  - artistSourceIdFromName: stable slug derived from a display name.
//    Mia doesn't expose a person identifier, so the adapter manufactures
//    one. Dedup tolerates small variations via similarity, but identical
//    names must produce identical slugs.
//
//  - parseLifeDate: extracts (nationality, birth_year, death_year) from
//    Mia's freeform life_date string. The years feed both the artist
//    record and one of the three dedup union-find keys.

export function primaryArtistName(
  field: string | undefined | null,
): string | null {
  if (!field) return null;
  let first = field.split(";")[0].trim();
  if (first.toLowerCase().startsWith("artist:")) {
    first = first.slice("artist:".length).trim();
  }
  return first === "" ? null : first;
}

export function artistSourceIdFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseLifeDate(life: string | undefined | null): {
  nationality: string | null;
  birth: number | null;
  death: number | null;
} {
  if (!life || life.trim() === "") {
    return { nationality: null, birth: null, death: null };
  }
  const nationalityMatch = life.match(/^([A-Za-z\- ]+?)(?=,|\(|\d|$)/);
  const nationality = nationalityMatch ? nationalityMatch[1].trim() : null;
  const years = life.match(/\d{3,4}/g) ?? [];
  return {
    nationality: nationality && nationality !== "" ? nationality : null,
    birth: years[0] ? Number(years[0]) : null,
    death: years[1] ? Number(years[1]) : null,
  };
}
