import { describe, expect, test } from "vitest";
import {
  clean,
  yearFrom,
  nationality,
  isAnonymousName,
  artistName,
  pickTitle,
  formatDimensions,
  primaryCreator,
  type SmkCreator,
  type SmkObject,
} from "./smk-parsers";

describe("clean", () => {
  test("returns null for empty/whitespace", () => {
    expect(clean("")).toBeNull();
    expect(clean("   ")).toBeNull();
    expect(clean(null)).toBeNull();
    expect(clean(undefined)).toBeNull();
  });

  test("trims leading/trailing whitespace", () => {
    expect(clean("  hello  ")).toBe("hello");
  });

  test("collapses internal double spaces", () => {
    expect(clean("oil  on  canvas")).toBe("oil on canvas");
  });

  test("replaces newlines with '; '", () => {
    expect(clean("line one\nline two")).toBe("line one; line two");
    expect(clean("a\r\nb")).toBe("a; b");
  });
});

describe("yearFrom", () => {
  test("extracts year from ISO date string", () => {
    expect(yearFrom("1574-01-01T00:00:00.000Z")).toBe(1574);
  });

  test("extracts leading year from a period string", () => {
    expect(yearFrom("1510-1530")).toBe(1510);
  });

  test("handles 3-digit years", () => {
    expect(yearFrom("800-850")).toBe(800);
  });

  test("returns null for null/empty", () => {
    expect(yearFrom(null)).toBeNull();
    expect(yearFrom("")).toBeNull();
    expect(yearFrom(undefined)).toBeNull();
  });

  test("returns null when no digit sequence found", () => {
    expect(yearFrom("unknown")).toBeNull();
  });
});

describe("nationality", () => {
  test("translates known Danish terms to English", () => {
    expect(nationality("dansk")).toBe("Danish");
    expect(nationality("Dansk")).toBe("Danish");
    expect(nationality("italiensk")).toBe("Italian");
    expect(nationality("Fransk")).toBe("French");
  });

  test("returns unknown terms as-is", () => {
    expect(nationality("Aztec")).toBe("Aztec");
  });

  test("returns null for empty/null", () => {
    expect(nationality("")).toBeNull();
    expect(nationality(null)).toBeNull();
  });
});

describe("isAnonymousName", () => {
  test("flags known anonymous placeholder names", () => {
    expect(isAnonymousName("Ubekendt")).toBe(true);
    expect(isAnonymousName("ukendt")).toBe(true);
    expect(isAnonymousName("Anonym")).toBe(true);
    expect(isAnonymousName("anonymous")).toBe(true);
    expect(isAnonymousName("Unknown")).toBe(true);
  });

  test("does not flag real artist names", () => {
    expect(isAnonymousName("Rembrandt van Rijn")).toBe(false);
    expect(isAnonymousName("C.W. Eckersberg")).toBe(false);
  });

  test("flags null/empty as anonymous", () => {
    expect(isAnonymousName(null)).toBe(true);
    expect(isAnonymousName("")).toBe(true);
  });
});

describe("artistName", () => {
  test("uses top-level artist array when present", () => {
    const obj: SmkObject = { artist: ["Christoffer Wilhelm Eckersberg"] };
    const creator: SmkCreator = { creator: "Eckersberg, C.W." };
    expect(artistName(obj, creator)).toBe("Christoffer Wilhelm Eckersberg");
  });

  test("builds 'Forename Surname' from name parts when no top-level artist", () => {
    const obj: SmkObject = {};
    const creator: SmkCreator = {
      creator_forename: "Tobias",
      creator_surname: "Stimmer",
    };
    expect(artistName(obj, creator)).toBe("Tobias Stimmer");
  });

  test("flips 'Surname, Forename' in creator field when no parts", () => {
    const obj: SmkObject = {};
    const creator: SmkCreator = { creator: "Stimmer, Tobias" };
    expect(artistName(obj, creator)).toBe("Tobias Stimmer");
  });

  test("returns creator field as-is when no comma", () => {
    const obj: SmkObject = {};
    const creator: SmkCreator = { creator: "Raphael" };
    expect(artistName(obj, creator)).toBe("Raphael");
  });

  test("returns empty string when all fields empty", () => {
    const obj: SmkObject = {};
    const creator: SmkCreator = {};
    expect(artistName(obj, creator)).toBe("");
  });
});

describe("pickTitle", () => {
  test("prefers 'beskrivelse' type title", () => {
    const titles = [
      { title: "Series title", type: "serietitel" },
      { title: "Descriptive title", type: "beskrivelse" },
    ];
    expect(pickTitle(titles)).toBe("Descriptive title");
  });

  test("falls back to first non-empty title when no beskrivelse", () => {
    const titles = [
      { title: "Landscape", type: "other" },
    ];
    expect(pickTitle(titles)).toBe("Landscape");
  });

  test("returns null for empty array", () => {
    expect(pickTitle([])).toBeNull();
    expect(pickTitle(undefined)).toBeNull();
  });

  test("skips empty title strings", () => {
    const titles = [
      { title: "", type: "beskrivelse" },
      { title: "Fallback", type: "other" },
    ];
    expect(pickTitle(titles)).toBe("Fallback");
  });
});

describe("formatDimensions", () => {
  test("translates Danish type and unit labels", () => {
    const dims = [
      { type: "højde", unit: "centimeter", value: "45.5" },
      { type: "bredde", unit: "centimeter", value: "60" },
    ];
    expect(formatDimensions(dims)).toBe("Height 45.5 cm, Width 60 cm");
  });

  test("falls back to raw strings for unknown type/unit", () => {
    const dims = [{ type: "ukjent", unit: "tommer", value: "12" }];
    expect(formatDimensions(dims)).toBe("ukjent 12 tommer");
  });

  test("skips entries with no value", () => {
    const dims = [
      { type: "højde", unit: "centimeter", value: "" },
      { type: "bredde", unit: "centimeter", value: "60" },
    ];
    expect(formatDimensions(dims)).toBe("Width 60 cm");
  });

  test("returns null for empty/undefined", () => {
    expect(formatDimensions([])).toBeNull();
    expect(formatDimensions(undefined)).toBeNull();
  });
});

describe("primaryCreator", () => {
  test("returns creator with no role when multiple are present", () => {
    const obj: SmkObject = {
      production: [
        { creator_lref: "123", creator_role: "Trykker" },
        { creator_lref: "456" },
      ],
    };
    expect(primaryCreator(obj)?.creator_lref).toBe("456");
  });

  test("falls back to first creator when all have roles", () => {
    const obj: SmkObject = {
      production: [
        { creator_lref: "111", creator_role: "Efter" },
        { creator_lref: "222", creator_role: "Trykker" },
      ],
    };
    expect(primaryCreator(obj)?.creator_lref).toBe("111");
  });

  test("excludes creators with empty lref", () => {
    const obj: SmkObject = {
      production: [
        { creator_lref: "   " },
        { creator_lref: "789" },
      ],
    };
    expect(primaryCreator(obj)?.creator_lref).toBe("789");
  });

  test("returns null when production is empty", () => {
    expect(primaryCreator({ production: [] })).toBeNull();
    expect(primaryCreator({})).toBeNull();
  });
});
