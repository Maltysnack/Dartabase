// Pure parser helpers for the Statens Museum for Kunst (SMK) ingestion adapter.
// Extracted so they can be unit-tested independently of the network layer.

export function clean(value: string | undefined | null): string | null {
  const normalized = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (normalized === "") return null;
  return normalized.replace(/\s*\n\s*/g, "; ").replace(/[ \t]{2,}/g, " ");
}

// A leading year out of an ISO date ("1574-01-01T00:00:00.000Z") or a period
// string ("1510-1530").
export function yearFrom(value: string | undefined | null): number | null {
  if (!value) return null;
  const match = value.match(/-?\d{3,4}/);
  return match ? Number(match[0]) : null;
}

// SMK catalogues nationality in Danish. Translate the common terms so the
// English-facing site shows English nationalities; fall back to the raw value.
export const NATIONALITY_DA_EN: Record<string, string> = {
  dansk: "Danish",
  grønlandsk: "Greenlandic",
  færøsk: "Faroese",
  italiensk: "Italian",
  tysk: "German",
  fransk: "French",
  hollandsk: "Dutch",
  nederlandsk: "Netherlandish",
  flamsk: "Flemish",
  belgisk: "Belgian",
  engelsk: "English",
  britisk: "British",
  skotsk: "Scottish",
  irsk: "Irish",
  amerikansk: "American",
  svensk: "Swedish",
  norsk: "Norwegian",
  finsk: "Finnish",
  islandsk: "Icelandic",
  spansk: "Spanish",
  portugisisk: "Portuguese",
  schweizisk: "Swiss",
  østrigsk: "Austrian",
  russisk: "Russian",
  polsk: "Polish",
  tjekkisk: "Czech",
  ungarsk: "Hungarian",
  græsk: "Greek",
  japansk: "Japanese",
  kinesisk: "Chinese",
};

export function nationality(value: string | undefined | null): string | null {
  const v = clean(value);
  if (!v) return null;
  return NATIONALITY_DA_EN[v.toLowerCase()] ?? v;
}

export const DIM_TYPE_DA_EN: Record<string, string> = {
  højde: "Height",
  bredde: "Width",
  dybde: "Depth",
  længde: "Length",
  diameter: "Diameter",
  vægt: "Weight",
};
export const DIM_UNIT_DA_EN: Record<string, string> = {
  millimeter: "mm",
  centimeter: "cm",
  meter: "m",
  gram: "g",
  kilogram: "kg",
};

export interface SmkCreator {
  creator?: string;
  creator_forename?: string;
  creator_surname?: string;
  creator_date_of_birth?: string;
  creator_date_of_death?: string;
  creator_nationality?: string;
  creator_role?: string | null;
  creator_lref?: string;
}

export interface SmkTitle {
  title?: string;
  type?: string;
  language?: string;
}

export interface SmkDimension {
  part?: string;
  type?: string;
  unit?: string;
  value?: string;
}

export interface SmkObject {
  artist?: string[];
  production?: SmkCreator[];
  titles?: SmkTitle[];
  dimensions?: SmkDimension[];
  [key: string]: unknown;
}

// Returns the primary creator for an SMK object. SMK lists printers
// ("Trykker") and "after" ("Efter") figures with a creator_role; the
// primary maker has no role set.
export function primaryCreator(object: SmkObject): SmkCreator | null {
  const creators = (object.production ?? []).filter(
    (c) => (c.creator_lref ?? "").trim() !== "",
  );
  if (creators.length === 0) return null;
  return creators.find((c) => !c.creator_role) ?? creators[0];
}

const ANONYMOUS_NAMES = new Set([
  "ubekendt",
  "ukendt",
  "anonym",
  "anonymous",
  "unknown",
]);
export function isAnonymousName(name: string | undefined | null): boolean {
  if (!name) return true;
  return ANONYMOUS_NAMES.has(name.trim().toLowerCase());
}

export function artistName(object: SmkObject, creator: SmkCreator): string {
  const top = (object.artist ?? [])
    .map((a) => (a ?? "").trim())
    .filter((a) => a !== "");
  if (top.length > 0) return top[0];

  const forename = (creator.creator_forename ?? "").trim();
  const surname = (creator.creator_surname ?? "").trim();
  if (forename && surname) return `${forename} ${surname}`;

  // `creator` arrives surname-first, e.g. "Stimmer, Tobias".
  const raw = (creator.creator ?? "").trim();
  if (raw.includes(", ")) {
    const [last, first] = raw.split(", ");
    return `${first} ${last}`.trim();
  }
  return raw;
}

// Prefer the descriptive title ("beskrivelse"); fall back to any non-empty title.
export function pickTitle(titles: SmkTitle[] | undefined): string | null {
  const list = titles ?? [];
  const descriptive = list.find(
    (t) => t.type === "beskrivelse" && (t.title ?? "").trim() !== "",
  );
  const chosen = descriptive ?? list.find((t) => (t.title ?? "").trim() !== "");
  return chosen ? clean(chosen.title) : null;
}

export function formatDimensions(dimensions: SmkDimension[] | undefined): string | null {
  const parts = (dimensions ?? [])
    .filter((d) => (d.value ?? "").trim() !== "")
    .map((d) => {
      const type =
        DIM_TYPE_DA_EN[(d.type ?? "").toLowerCase()] ?? (d.type ?? "");
      const unit =
        DIM_UNIT_DA_EN[(d.unit ?? "").toLowerCase()] ?? (d.unit ?? "");
      return `${type} ${d.value} ${unit}`.replace(/\s+/g, " ").trim();
    });
  return parts.length > 0 ? parts.join(", ") : null;
}
