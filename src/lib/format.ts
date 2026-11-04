// Small display helpers shared across pages.

export function formatYear(year: number | null): string {
  if (year == null) return "";
  if (year < 0) return `${Math.abs(year)} BCE`;
  return String(year);
}

// Normalise a source-supplied date string for display. Each source's house
// style leaks through verbatim otherwise: "1868 - 1869", "ca. 1870 - 1880",
// "c. 1868–73", "Early 1887", "fall 1906" all appear on a single artist
// page. We can fix typography without altering meaning; colloquial words
// stay untouched.
//
// Rules:
//   1. Year-year ranges  -> en dash, no surrounding whitespace.
//   2. "ca."             -> "c." (consistent circa abbreviation).
//   3. Collapse internal whitespace; trim.
export function normaliseDateText(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/(\d{4})\s*[-–\u2014]\s*(\d{1,4})/g, "$1–$2")
    .replace(/\bca\.\s?/gi, "c. ")
    .replace(/\s+/g, " ")
    .trim();
}

// Cultural/geographic attribution strings stored as artist names distort the
// /artists discovery surface. Filter them at the index level; real search
// still finds them. "Unknown" variants were deleted from the DB by
// scripts/consolidate-unknown-artists.ts; the /i pattern below is a
// belt-and-suspenders guard against future ingestion regressions.
const CULTURAL_ATTRIBUTIONS = new Set([
  "China",
  "Egyptian",
  "Japanese",
  "Greek",
  "Roman",
  "Indian",
  "Persian",
  "Korean",
  "Tibetan",
]);
export function isPlaceholderArtist(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^(unknown|unidentified|anonymous)/i.test(trimmed)) return true;
  if (/^after\s/i.test(trimmed)) return true;
  if (CULTURAL_ATTRIBUTIONS.has(trimmed)) return true;
  return false;
}

// Pass image URLs through unchanged. Images load directly from museum CDNs
// in the browser (real browser UA, no 403 issues). The /api/img proxy was
// removed to eliminate unnecessary Vercel Function invocations and bandwidth.
export function proxiedImageUrl(src: string | null): string | null {
  return src;
}

// Classifies a source-supplied image-rights string into a short badge for
// listing rows. We only badge what is clearly clearable: CC0 waivers and
// public-domain works. Ambiguous strings ("see source", institution name
// only) return null; better to say nothing than to mislead a student
// deciding whether to reproduce a thumbnail in their essay's appendix.
export function imageRightsBadge(
  license: string | null,
): "CC0" | "Public domain" | null {
  if (!license) return null;
  if (/\bCC0\b/i.test(license)) return "CC0";
  if (/public domain/i.test(license)) return "Public domain";
  return null;
}

export type RightsStatus = "cc0" | "public-domain" | "check-source" | "no-image" | "unknown";

export interface RightsInfo {
  status: RightsStatus;
  label: string;
  // One plain-English sentence for display, ending without period so callers can append punctuation.
  description: string;
}

// Returns a plain-language rights description for the artwork detail page.
// Designed to help researchers and creators understand reuse permissions at
// a glance, without implying any rights that aren't clearly established.
export function artworkRights(
  license: string | null,
  hasImage: boolean,
): RightsInfo {
  if (!hasImage) {
    return {
      status: "no-image",
      label: "No image",
      description: "Only metadata is available for this record; no image is served by Dartabase",
    };
  }

  if (/\bCC0\b/i.test(license ?? "")) {
    return {
      status: "cc0",
      label: "CC0",
      description: "No known copyright restrictions. Free to reproduce, adapt, and share without attribution",
    };
  }

  if (/public domain/i.test(license ?? "")) {
    return {
      status: "public-domain",
      label: "Public domain",
      description: "No known copyright restrictions. Free to reproduce and share",
    };
  }

  if (license && license !== "unknown") {
    return {
      status: "check-source",
      label: "Rights reserved",
      description: "Image rights belong to the holding institution. Check the source record before reusing",
    };
  }

  return {
    status: "unknown",
    label: "Rights unknown",
    description: "Rights status is not confirmed. Contact the holding institution before reusing",
  };
}

// A human display of an artwork's date, preferring the source's own text.
export function artworkDate(
  dateText: string | null,
  dateYear: number | null,
): string {
  const normalised = normaliseDateText(dateText);
  if (normalised) return normalised;
  return formatYear(dateYear);
}

// An artist's life span, e.g. "1899–1991", "b. 1944", "d. 1850".
export function lifeSpan(
  birth: number | null,
  death: number | null,
): string {
  const b = birth != null ? formatYear(birth) : "";
  const d = death != null ? formatYear(death) : "";
  if (b && d) return `${b}–${d}`;
  if (b) return `b. ${b}`;
  if (d) return `d. ${d}`;
  return "";
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Formats an ISO date (YYYY-MM-DD) as "6 Feb 2015".
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ""} ${year}`;
}

// Synthesized one-line factual bio for an institution (issue #21). Pure
// projection of structured fields; never editorial prose. Returns "" when
// there is nothing useful to say (no type, no place, no founded year).
//
//   "Art museum in Hobart, Australia. Opened 2011."
//   "Art gallery in Brisbane, Australia. Founded 1895."
//   "Art museum in Chicago, United States."
//   "Founded 1879."   (when type and place are both unknown)
//
// "Opened" reads more naturally for purpose-built modern institutions; we
// have no signal to distinguish them, so the safer general verb is "Founded"
// and we use that uniformly. Future enhancement: use "Opened" when the
// institution has a separate building-completion date that matches.
export function institutionBio(institution: {
  type: string | null;
  city: string | null;
  country: string | null;
  founded_year: number | null;
}): string {
  const place = [institution.city, institution.country]
    .filter(Boolean)
    .join(", ");
  // "Museum" / "gallery" usually arrive lowercased; capitalise the first
  // letter only if the type leads the sentence (it always does here).
  const t = (institution.type ?? "").trim().toLowerCase();
  const lede =
    t && place
      ? `${capitalise(t)} in ${place}`
      : t
        ? capitalise(t)
        : place
          ? `Institution in ${place}`
          : "";
  const tail =
    institution.founded_year != null ? `Founded ${institution.founded_year}` : "";
  if (lede && tail) return `${lede}. ${tail}.`;
  if (lede) return `${lede}.`;
  if (tail) return `${tail}.`;
  return "";
}

function capitalise(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

// Maps a free-text medium string to one of the seven browse buckets, matching
// the ILIKE patterns used in the DB RPCs (migration 0014_medium_facets.sql).
// Returns null when no bucket matches, which is the common case for mixed or
// unusual media.
export function deriveMediumBucket(medium: string | null): string | null {
  if (!medium) return null;
  const m = medium.toLowerCase();
  const has = (...terms: string[]) => terms.some((t) => m.includes(t));
  if (has("oil", "watercolour", "watercolor", "gouache", "tempera", "polymer paint", "öl auf", "mischtechnik", "acrylic", "distemper", "encaustic")) return "Painting";
  if (has("etching", "radering", "engraving", "kobberstik", "lithograph", "screenprint", "woodcut", "træsnit", "linocut", "aquatint", "mezzotint", "drypoint", "intaglio", "monotype")) return "Print";
  if (has("graphite", "chalk", "charcoal", "pencil", "crayon", "pastel", "ink on paper", "brush and")) return "Drawing";
  if (has("photograph", "gelatin silver", "chromogenic", "daguerreotype", "albumen", "cyanotype", "palladium print", "pigment print", "silver print")) return "Photography";
  if (has("bronze", "marble", "ivory", "granite", "sandstone", "limestone", "alabaster", "basalt")) return "Sculpture";
  if (has("earthenware", "porcelain", "stoneware", "ceramic", "faience", "majolica", "terracotta")) return "Ceramics";
  if (has("wool", "silk", "tapestry", "weave", "embroid", "lace", "cotton", "linen")) return "Textile";
  if (has("video", "dvd", "animation", "moving image", "motion picture")) return "Video";
  if (has("installation")) return "Installation";
  return null;
}

// Formats an exhibition's run, e.g. "6 Feb 2015 – 19 Jul 2015".
export function formatExhibitionDates(
  start: string | null,
  end: string | null,
): string {
  const from = formatDate(start);
  const to = formatDate(end);
  if (from && to) return `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return "";
}

export interface TourVenueEntry {
  venueLocation: string;
  isOrganizer: boolean;
  dates: string | null;
  url: string | null;
}

const MONTH_NAMES_PATTERN =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE_PAREN_RE = new RegExp(
  `\\(([^)]*(?:${MONTH_NAMES_PATTERN}|\\d{4})[^)]*)\\)\\s*$`,
  "i",
);

// Parses the Cleveland-style exhibition description into a structured list of
// tour venues. Format: "Title. Venue, City (organizer) (dates) URL; Venue2..."
// Returns null when the description doesn't have multiple venues (no need to
// show a structured list for a single-venue record whose data is already in
// the institution/date fields).
export function parseTourVenues(
  title: string,
  description: string,
): TourVenueEntry[] | null {
  // Strip the leading title: everything up to and including the first ". "
  let body: string;
  const prefix = title + ". ";
  if (description.startsWith(prefix)) {
    body = description.slice(prefix.length);
  } else {
    const dotSpace = description.indexOf(". ");
    if (dotSpace === -1) return null;
    body = description.slice(dotSpace + 2);
  }

  body = body.replace(/\.\s*$/, "").trim();
  if (!body) return null;

  const rawSegments = body.split(/\s*;\s*/);
  const entries: TourVenueEntry[] = [];

  for (const raw of rawSegments) {
    let seg = raw.trim();
    if (!seg) continue;

    // Extract URL
    const urlMatch = seg.match(/(https?:\/\/\S+)/);
    const url = urlMatch ? urlMatch[1] : null;
    if (url) seg = seg.replace(url, "").trim();

    seg = seg.replace(/\.\s*$/, "").trim();

    const isOrganizer = /\(\s*organizer\s*\)/i.test(seg);
    seg = seg.replace(/\s*\(\s*organizer\s*\)/i, "").trim();

    const datesMatch = seg.match(DATE_PAREN_RE);
    const dates = datesMatch ? datesMatch[1] : null;
    if (datesMatch) {
      seg = seg.slice(0, datesMatch.index).trim();
    }

    seg = seg.replace(/,\s*$/, "").trim();

    if (seg) {
      entries.push({ venueLocation: seg, isOrganizer, dates, url });
    }
  }

  // Only return structured data when there are multiple venues; single-venue
  // records duplicate data already shown via institution + date fields.
  return entries.length >= 2 ? entries : null;
}
