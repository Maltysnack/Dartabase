// Shared year-from-text parser for ingestion adapters.
//
// The same parser shape existed inline in six adapters (smithsonian, mia,
// nga, moma, staedel, harvard) and one of them silently shipped a sign bug
// for ancient artifacts: BCE dates were stored as positive integers because
// the inline parser's comment promised "the caller will negate when BCE is
// detected," but no caller ever did. The mistake was easy to make and easy
// to miss in review. Extracting to one place + adding tests is the
// regression fence.
//
// The function picks the first 3-4 digit run in the text and negates when
// the surrounding text marks the date as before the common era. Existing
// explicit negatives ("-425") are preserved as-is. Returns null when no
// year-shaped substring is present.

const BCE_RE = /\bBCE\b|\bBC\b|\bB\.C\.E?\.|\bbefore (the )?common era\b/i;

export function yearFromText(
  value: string | number | undefined | null,
): number | null {
  if (value == null || value === "") return null;
  // Coerce non-string inputs to a string for the regex match. The Städel
  // adapter passes values from a LIDO XML parser that auto-converts purely
  // numeric date elements (e.g. <earliestDate>1471</earliestDate>) to
  // JavaScript numbers; without coercion, value.match throws. Catching
  // numbers explicitly here is cheaper than asking every caller to wrap.
  const str = typeof value === "string" ? value : String(value);
  const match = str.match(/-?\d{3,4}/);
  if (!match) return null;
  const n = Number(match[0]);
  if (n < 0) return n;
  return BCE_RE.test(str) ? -n : n;
}
