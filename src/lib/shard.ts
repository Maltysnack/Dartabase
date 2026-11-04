// Shared by the export script (writes the static data) and the browser
// (reads it), so the two can never disagree about which file holds a record.

// Records live in files named by the first hex characters of their UUID.
// 3 characters gives 4096 files of roughly 30 records each.
export function idKey(id: string): string {
  return id.replace(/-/g, "").slice(0, 3).toLowerCase();
}

export function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Search tokens: latin words of 3+ characters, or any non-latin word.
export function tokens(text: string): string[] {
  const out = new Set<string>();
  for (const t of normalise(text).split(/[^\p{L}\p{N}]+/u)) {
    if (!t) continue;
    if (t.length >= 3 || /[^\u0000-ɏ]/.test(t)) out.add(t);
  }
  return [...out];
}

// Search files are keyed by a token's first 3 characters, as hex so that any
// script gives a safe file name.
export function tokenKey(token: string): string {
  return Array.from(token)
    .slice(0, 3)
    .map((c) => (c.codePointAt(0) as number).toString(16))
    .join("-");
}

export type SearchArtwork = [
  id: string,
  title: string,
  artist: string | null,
  year: number | null,
  hasImage: 0 | 1,
];

export type SearchArtist = [
  id: string,
  name: string,
  birth: number | null,
  death: number | null,
  nationality: string | null,
  works: number,
];
