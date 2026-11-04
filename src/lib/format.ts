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
