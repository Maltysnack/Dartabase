// Slug generation utilities for artwork and artist URLs.
// Mirrors src/lib/slug.ts; kept separate because scripts cannot resolve @/* aliases.

const MAX_TITLE_CHARS = 60;
const MAX_ARTIST_CHARS = 40;

export function toSlug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function artistSlug(name: string): string {
  return toSlug(name);
}

export function artworkSlug(
  title: string,
  artistName: string | null | undefined,
  year: number | null | undefined,
): string {
  const titlePart = toSlug(title).slice(0, MAX_TITLE_CHARS).replace(/-+$/, "");
  const artistPart = artistName
    ? toSlug(artistName).slice(0, MAX_ARTIST_CHARS).replace(/-+$/, "")
    : null;
  const yearPart = year ? String(year) : null;
  const parts = [titlePart, artistPart, yearPart].filter(Boolean);
  return parts.join("-");
}
