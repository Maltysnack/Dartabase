// Pure parser helpers for the Walters Art Museum ingestion adapter.

export function clean(value: string | undefined | null): string | null {
  const normalized = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (normalized === "") return null;
  return normalized.replace(/\s*\n\s*/g, "; ").replace(/[ \t]{2,}/g, " ");
}

export function intOrNull(value: string | undefined | null): number | null {
  const v = (value ?? "").trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

// Walters catalogues creator life data inside a parenthetical:
//   " (Persian, ca. 1565-1635)"  or  " (American, active 1879-1890)".
// Pull the leading nationality and up to two years.
export function parseCreatorDate(field: string | undefined | null): {
  nationality: string | null;
  birth: number | null;
  death: number | null;
} {
  if (!field) return { nationality: null, birth: null, death: null };
  const paren = field.match(/\(([^)]*)\)/);
  if (!paren) return { nationality: null, birth: null, death: null };
  const inside = paren[1];
  const firstComma = inside.split(",")[0]?.trim() ?? "";
  const nationality = firstComma === "" ? null : firstComma;
  const years = inside.match(/\d{3,4}/g) ?? [];
  return {
    nationality,
    birth: years[0] ? Number(years[0]) : null,
    death: years[1] ? Number(years[1]) : null,
  };
}
