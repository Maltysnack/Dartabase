
// Minimal shape needed by bibtex() and ris() -- a subset of ArtworkFull that
// ExportRow and other lightweight shapes also satisfy.
export type ArtworkExportable = {
  id: string;
  title: string | null;
  date_year: number | null;
  medium: string | null;
  source: string;
  source_id: string | null;
  artist: { name: string; sort_name?: string | null } | null;
  institution: { name: string; city: string | null } | null;
};
import { artworkDate, formatYear } from "./format";

// Minimum shape needed by the text citation functions (Chicago, MLA, APA).
// ArtworkFull satisfies this; ArtworkCard does too once CARD_SELECT includes
// sort_name and city.
export type ArtworkCiteable = {
  title: string | null;
  date_text: string | null;
  date_year: number | null;
  medium: string | null;
  artist: { name: string; sort_name?: string | null } | null;
  institution: { name: string; city?: string | null } | null;
};

export const CITATION_STYLES = ["chicago", "mla", "apa", "harvard"] as const;
export type CitationStyle = (typeof CITATION_STYLES)[number];

export const CITATION_LABELS: Record<CitationStyle, string> = {
  chicago: "Chicago",
  mla: "MLA",
  apa: "APA",
  harvard: "Harvard",
};

// A citation is a sequence of text runs; the artwork title is italic.
export interface CitationPart {
  text: string;
  italic?: boolean;
}

// Prefixes that flag an artwork as not by the canonical artist. When these
// appear in the artist name, the whole phrase is cited as-is (no inversion,
// no APA initials), because "Rembrandt, Workshop of" or "Rembrandt, R." for
// a workshop attribution would misrepresent the work. The match is anchored
// and case-insensitive.
const ATTRIBUTION_PREFIX_RE =
  /^(attributed to|after|follower of|workshop of|circle of|manner of|school of|imitator of|studio of|copy after|formerly attributed to)\b/i;

function hasAttributionPrefix(name: string): boolean {
  return ATTRIBUTION_PREFIX_RE.test(name.trim());
}

interface ParsedName {
  display: string; // "Alfred Stieglitz"
  inverted: string; // "Stieglitz, Alfred"
  apa: string; // "Stieglitz, A."
}

function parseName(name: string, sortName: string | null): ParsedName {
  // Attribution phrases ("Attributed to Rembrandt") are cited whole. Firms
  // and cultures ("Baccarat Glassworks", "Ancient Egyptian") have no comma
  // in their sort name and are also cited whole, without inversion.
  if (hasAttributionPrefix(name)) {
    return { display: name, inverted: name, apa: name };
  }
  if (sortName && sortName.includes(",")) {
    const [last, ...restParts] = sortName.split(",");
    const lastName = last.trim();
    const given = restParts.join(",").trim();
    const initials = given
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => `${part[0].toUpperCase()}.`)
      .join(" ");
    return {
      display: name,
      inverted: `${lastName}, ${given}`,
      apa: initials ? `${lastName}, ${initials}` : lastName,
    };
  }
  return { display: name, inverted: name, apa: name };
}

// Untitled works are displayed with bracketed "[Untitled]" in all three
// styles, never italicised: the brackets signal a descriptive placeholder,
// not the work's actual title. Detection covers true nulls, empty strings,
// and source records that literally use "Untitled" or "[Untitled]" as the
// title (so the brackets never double up).
function displayTitle(rawTitle: string | null): CitationPart {
  const title = (rawTitle ?? "").trim();
  if (title === "" || /^\[?untitled\]?$/i.test(title)) {
    return { text: "[Untitled]" };
  }
  return { text: title, italic: true };
}

// Citation-style date. Falls back to "n.d." when both the source's date text
// and the parsed year are missing, matching the convention every major style
// uses for art with unknown dates.
function displayDate(artwork: ArtworkCiteable): string {
  const value = artworkDate(artwork.date_text, artwork.date_year);
  return value || "n.d.";
}

// Repository clause: institution name plus city. Returns empty when there is
// no current institution, which is correct: the work is in a private
// collection or unlocated, and citation styles simply omit the clause.
function place(artwork: ArtworkCiteable): string {
  const institution = artwork.institution;
  if (!institution) return "";
  return [institution.name, institution.city].filter(Boolean).join(", ");
}

function chicago(artwork: ArtworkCiteable): CitationPart[] {
  // Chicago Manual of Style (note form) for visual art:
  //   Artist First Last, Title, date, medium, repository, city.
  // Attribution phrases replace the artist field as-is. Untitled and undated
  // works follow the bracketed placeholder / "n.d." conventions above.
  const parts: CitationPart[] = [];
  if (artwork.artist) {
    const name = parseName(artwork.artist.name, artwork.artist.sort_name ?? null);
    parts.push({ text: `${name.display}, ` });
  }
  parts.push(displayTitle(artwork.title));
  const tail = [
    displayDate(artwork),
    artwork.medium ?? "",
    place(artwork),
  ].filter((value) => value !== "");
  if (tail.length > 0) parts.push({ text: `, ${tail.join(", ")}` });
  // The tail can end with "n.d." which already carries its own period; avoid
  // doubling it.
  const tailText = tail.join(", ");
  parts.push({ text: tailText.endsWith(".") ? "" : "." });
  return parts;
}

function mla(artwork: ArtworkCiteable): CitationPart[] {
  // MLA 9 for art:
  //   Last, First. Title. Year, Institution, City.
  // Inverted names only apply where there is a personal name; attributions
  // and firms render as-is.
  const parts: CitationPart[] = [];
  if (artwork.artist) {
    const name = parseName(artwork.artist.name, artwork.artist.sort_name ?? null);
    parts.push({ text: `${name.inverted}. ` });
  }
  parts.push(displayTitle(artwork.title));
  parts.push({ text: "." });
  const tail = [displayDate(artwork), place(artwork)].filter(
    (value) => value !== "",
  );
  if (tail.length > 0) {
    const joined = tail.join(", ");
    // "n.d." already ends in a period; do not double it.
    parts.push({ text: joined.endsWith(".") ? ` ${joined}` : ` ${joined}.` });
  }
  return parts;
}

function apa(artwork: ArtworkCiteable): CitationPart[] {
  // APA 7 for art:
  //   Surname, A. (Year). Title [Medium]. Institution, City.
  // APA uses (n.d.) for unknown dates and brackets the medium as a content
  // descriptor regardless of whether the title is bracketed.
  const parts: CitationPart[] = [];
  if (artwork.artist) {
    const name = parseName(artwork.artist.name, artwork.artist.sort_name ?? null);
    parts.push({ text: `${name.apa} ` });
  }
  const year =
    artwork.date_year != null ? formatYear(artwork.date_year) : "n.d.";
  parts.push({ text: `(${year}). ` });
  parts.push(displayTitle(artwork.title));
  if (artwork.medium) parts.push({ text: ` [${artwork.medium}]` });
  parts.push({ text: "." });
  const location = place(artwork);
  if (location) parts.push({ text: ` ${location}.` });
  return parts;
}

function harvard(artwork: ArtworkCiteable): CitationPart[] {
  // Harvard (Cite Them Right) for visual art:
  //   Surname, Initial. (Year) Title. [Medium]. Institution, City.
  // Like APA it is author-date, but the year carries no trailing period, the
  // title is its own sentence, and the medium is a separate bracketed element.
  const parts: CitationPart[] = [];
  if (artwork.artist) {
    const name = parseName(artwork.artist.name, artwork.artist.sort_name ?? null);
    parts.push({ text: `${name.apa} ` });
  }
  const year =
    artwork.date_year != null ? formatYear(artwork.date_year) : "n.d.";
  parts.push({ text: `(${year}) ` });
  parts.push(displayTitle(artwork.title));
  parts.push({ text: "." });
  if (artwork.medium) parts.push({ text: ` [${artwork.medium}].` });
  const location = place(artwork);
  if (location) parts.push({ text: ` ${location}.` });
  return parts;
}

export function buildCitation(
  style: CitationStyle,
  artwork: ArtworkCiteable,
): CitationPart[] {
  let parts: CitationPart[];
  switch (style) {
    case "mla":
      parts = mla(artwork);
      break;
    case "apa":
      parts = apa(artwork);
      break;
    case "harvard":
      parts = harvard(artwork);
      break;
    case "chicago":
    default:
      parts = chicago(artwork);
      break;
  }
  return parts;
}

export function citationToText(parts: CitationPart[]): string {
  return parts.map((part) => part.text).join("");
}

// BibTeX export (uses @misc since @artwork is not a standard type).
export function bibtex(artwork: ArtworkExportable, citeUrl: string): string {
  const key = `${artwork.source}_${(artwork.source_id ?? artwork.id).replace(/[^A-Za-z0-9]/g, "_")}`;
  const authorName = artwork.artist?.name;
  const authorInverted = authorName
    ? (() => {
        const parsed = parseName(authorName, artwork.artist?.sort_name ?? null);
        return parsed.inverted;
      })()
    : null;
  const year = artwork.date_year ?? null;
  const institution = artwork.institution?.name ?? null;
  const city = artwork.institution?.city ?? null;
  const address = [institution, city].filter(Boolean).join(", ");

  const lines: string[] = [`@misc{${key},`];
  if (authorInverted) lines.push(`  author    = {${authorInverted}},`);
  lines.push(`  title     = {{${artwork.title ?? "[Untitled]"}}},`);
  if (year) lines.push(`  year      = {${year}},`);
  if (artwork.medium) lines.push(`  note      = {${artwork.medium}},`);
  if (address) lines.push(`  howpublished = {${address}},`);
  lines.push(`  url       = {${citeUrl}},`);
  lines.push(`}`);
  return lines.join("\n");
}

// RIS export (TY=ART).
export function ris(artwork: ArtworkExportable, citeUrl: string): string {
  const authorName = artwork.artist?.name;
  const authorInverted = authorName
    ? (() => {
        const parsed = parseName(authorName, artwork.artist?.sort_name ?? null);
        return parsed.inverted;
      })()
    : null;
  const year = artwork.date_year ?? null;

  const lines: string[] = ["TY  - ART"];
  if (authorInverted) lines.push(`AU  - ${authorInverted}`);
  lines.push(`TI  - ${artwork.title ?? "[Untitled]"}`);
  if (year) lines.push(`PY  - ${year}`);
  if (artwork.institution?.name) lines.push(`PB  - ${artwork.institution.name}`);
  if (artwork.institution?.city) lines.push(`CY  - ${artwork.institution.city}`);
  if (artwork.medium) lines.push(`M3  - ${artwork.medium}`);
  lines.push(`UR  - ${citeUrl}`);
  lines.push("ER  - ");
  return lines.join("\r\n");
}
