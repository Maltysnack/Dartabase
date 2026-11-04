// Pure parser helpers for the Tate ingestion adapter.

export function clean(value: string | undefined | null): string | null {
  const s = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (s === "") return null;
  return s.replace(/\s*\n\s*/g, "; ").replace(/[ \t]{2,}/g, " ");
}

// Tate artist names are "Surname, Forename" - flip to "Forename Surname".
// Names without a comma are returned as-is.
export function flipName(name: string): string {
  const comma = name.indexOf(",");
  if (comma === -1) return name.trim();
  const surname = name.slice(0, comma).trim();
  const forename = name.slice(comma + 1).trim();
  return forename ? `${forename} ${surname}` : surname;
}

// Rewrite old http://www.tate.org.uk/art/images/... URLs to the current CDN.
export function rewriteTateImageUrl(raw: string | undefined | null): string | null {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  return s
    .replace(/^http:\/\/www\.tate\.org\.uk\/art\/images\//, "https://media.tate.org.uk/art/images/")
    .replace(/^https?:\/\/www\.tate\.org\.uk\/art\/images\//, "https://media.tate.org.uk/art/images/");
}
