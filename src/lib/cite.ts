import type { ArtworkCard, ArtworkFull } from "./types";

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

// Cast an ArtworkCard to ArtworkCiteable. The card shape satisfies the
// required fields after CARD_SELECT was extended with sort_name and city.
export function cardForCitation(card: ArtworkCard): ArtworkCiteable {
  return card as ArtworkCiteable;
}

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

// An exhibition the work was seen in, for an optional appended clause.
export interface CiteExhibition {
  title: string;
  venue: string | null;
  dates: string | null;
}

function exhibitionParts(exhibition: CiteExhibition): CitationPart[] {
  const parts: CitationPart[] = [{ text: " Exhibited in " }];
  parts.push({ text: exhibition.title, italic: true });
  const tail = [exhibition.venue, exhibition.dates].filter(
    (value): value is string => value !== null && value !== "",
  );
  parts.push({ text: tail.length > 0 ? `, ${tail.join(", ")}.` : "." });
  return parts;
}

export function buildCitation(
  style: CitationStyle,
  artwork: ArtworkCiteable,
  exhibition?: CiteExhibition | null,
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
  return exhibition ? [...parts, ...exhibitionParts(exhibition)] : parts;
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

// Wall label / tombstone format for curators. Returns plain text with newlines.
//   Artist Name
//   Title, date
//   Medium
//   Dimensions
//   Collection, City. Credit line. Accession no.
// Missing fields are omitted; the last line is only emitted when at least
// one of its constituents is present.
export function wallLabel(artwork: ArtworkFull): string {
  const lines: string[] = [];
  if (artwork.artist) lines.push(artwork.artist.name);
  const date = artworkDate(artwork.date_text, artwork.date_year);
  lines.push([artwork.title, date].filter(Boolean).join(", "));
  if (artwork.medium) lines.push(artwork.medium);
  if (artwork.dimensions) lines.push(artwork.dimensions);
  const lastParts = [
    [artwork.institution?.name, artwork.institution?.city]
      .filter(Boolean)
      .join(", "),
    artwork.credit_line?.replace(/\.+\s*$/, "") || null,
    artwork.source_id ? `Accession no. ${artwork.source_id}` : null,
  ].filter((p): p is string => Boolean(p));
  if (lastParts.length > 0) lines.push(lastParts.join(". ") + ".");
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

// ---------------------------------------------------------------------------
// Exhibition citations
// ---------------------------------------------------------------------------

export type ExhibitionCiteable = {
  title: string;
  start_date: string | null;
  end_date: string | null;
  institution: { name: string; city: string | null } | null;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_ABBR = [
  "Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.",
  "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec.",
];

function parseIsoDate(iso: string | null): { year: number; month: number; day: number } | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
}

function chicagoDate(iso: string | null): string {
  const d = parseIsoDate(iso);
  if (!d) return "";
  return `${MONTH_NAMES[d.month - 1]} ${d.day}, ${d.year}`;
}

function mlaDate(iso: string | null): string {
  const d = parseIsoDate(iso);
  if (!d) return "";
  return `${d.day} ${MONTH_ABBR[d.month - 1]} ${d.year}`;
}

function exhibitionYear(start: string | null, end: string | null): string {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  if (s) return String(s.year);
  if (e) return String(e.year);
  return "n.d.";
}

function chicagoDateRange(start: string | null, end: string | null): string {
  const s = chicagoDate(start);
  const e = chicagoDate(end);
  if (s && e) return `${s} – ${e}`;
  if (s) return s;
  if (e) return e;
  return "";
}

function mlaDateRange(start: string | null, end: string | null): string {
  const s = mlaDate(start);
  const e = mlaDate(end);
  if (s && e) return `${s} – ${e}`;
  if (s) return s;
  if (e) return e;
  return "";
}

function exhibitionChicago(ex: ExhibitionCiteable, url: string): CitationPart[] {
  const parts: CitationPart[] = [];
  parts.push({ text: ex.title, italic: true });
  const venueCity = [ex.institution?.name, ex.institution?.city]
    .filter(Boolean)
    .join(", ");
  if (venueCity) parts.push({ text: `. ${venueCity}.` });
  else parts.push({ text: "." });
  const dates = chicagoDateRange(ex.start_date, ex.end_date);
  if (dates) parts.push({ text: ` ${dates}.` });
  parts.push({ text: " Dartabase. " });
  parts.push({ text: url });
  parts.push({ text: "." });
  return parts;
}

function exhibitionMla(ex: ExhibitionCiteable, url: string): CitationPart[] {
  const parts: CitationPart[] = [];
  parts.push({ text: ex.title, italic: true });
  const venueCity = [ex.institution?.name, ex.institution?.city]
    .filter(Boolean)
    .join(", ");
  if (venueCity) parts.push({ text: `. ${venueCity}.` });
  else parts.push({ text: "." });
  const dates = mlaDateRange(ex.start_date, ex.end_date);
  if (dates) parts.push({ text: ` ${dates}.` });
  parts.push({ text: " Dartabase, " });
  parts.push({ text: url });
  parts.push({ text: "." });
  return parts;
}

function exhibitionApa(ex: ExhibitionCiteable, url: string): CitationPart[] {
  const parts: CitationPart[] = [];
  if (ex.institution?.name) {
    parts.push({ text: `${ex.institution.name}. ` });
  }
  const year = exhibitionYear(ex.start_date, ex.end_date);
  parts.push({ text: `(${year}). ` });
  parts.push({ text: ex.title, italic: true });
  parts.push({ text: " [Exhibition record]." });
  const venueCity = [ex.institution?.name, ex.institution?.city]
    .filter(Boolean)
    .join(", ");
  if (venueCity) parts.push({ text: ` ${venueCity}.` });
  parts.push({ text: ` ${url}.` });
  return parts;
}

function exhibitionHarvard(ex: ExhibitionCiteable, url: string): CitationPart[] {
  // Harvard (Cite Them Right) for an exhibition:
  //   Institution (Year) Title [Exhibition]. City. Available at: url.
  const parts: CitationPart[] = [];
  if (ex.institution?.name) {
    parts.push({ text: `${ex.institution.name} ` });
  }
  const year = exhibitionYear(ex.start_date, ex.end_date);
  parts.push({ text: `(${year}) ` });
  parts.push({ text: ex.title, italic: true });
  parts.push({ text: " [Exhibition]." });
  if (ex.institution?.city) parts.push({ text: ` ${ex.institution.city}.` });
  parts.push({ text: ` Available at: ${url}.` });
  return parts;
}

export function buildExhibitionCitation(
  style: CitationStyle,
  exhibition: ExhibitionCiteable,
  url: string,
): CitationPart[] {
  switch (style) {
    case "mla":
      return exhibitionMla(exhibition, url);
    case "apa":
      return exhibitionApa(exhibition, url);
    case "harvard":
      return exhibitionHarvard(exhibition, url);
    case "chicago":
    default:
      return exhibitionChicago(exhibition, url);
  }
}
