import { describe, expect, test } from "vitest";
import { parseCreatorDate, intOrNull } from "./walters-parsers";

describe("parseCreatorDate", () => {
  test("extracts nationality and birth/death from a typical entry", () => {
    expect(parseCreatorDate("Rembrandt van Rijn (Dutch, 1606-1669)")).toEqual({
      nationality: "Dutch",
      birth: 1606,
      death: 1669,
    });
  });

  test("handles 'ca.' prefix before years", () => {
    expect(parseCreatorDate("Unknown (Persian, ca. 1565-1635)")).toEqual({
      nationality: "Persian",
      birth: 1565,
      death: 1635,
    });
  });

  test("handles 'active' with a date range", () => {
    expect(parseCreatorDate("Maker (American, active 1879-1890)")).toEqual({
      nationality: "American",
      birth: 1879,
      death: 1890,
    });
  });

  test("returns only birth when a single year is present", () => {
    expect(parseCreatorDate("Artist (French, born 1950)")).toEqual({
      nationality: "French",
      birth: 1950,
      death: null,
    });
  });

  test("returns all nulls when no parenthetical present", () => {
    expect(parseCreatorDate("Rembrandt van Rijn")).toEqual({
      nationality: null,
      birth: null,
      death: null,
    });
  });

  test("returns all nulls for null/undefined", () => {
    expect(parseCreatorDate(null)).toEqual({
      nationality: null,
      birth: null,
      death: null,
    });
    expect(parseCreatorDate(undefined)).toEqual({
      nationality: null,
      birth: null,
      death: null,
    });
  });

  test("handles nationality with no years", () => {
    expect(parseCreatorDate("Artist (Flemish)")).toEqual({
      nationality: "Flemish",
      birth: null,
      death: null,
    });
  });
});

describe("intOrNull", () => {
  test("parses integer strings", () => {
    expect(intOrNull("1234")).toBe(1234);
    expect(intOrNull("0")).toBe(0);
  });

  test("returns null for empty/null/whitespace", () => {
    expect(intOrNull("")).toBeNull();
    expect(intOrNull(null)).toBeNull();
    expect(intOrNull("   ")).toBeNull();
  });

  test("returns null for non-integer values", () => {
    expect(intOrNull("3.14")).toBeNull();
    expect(intOrNull("abc")).toBeNull();
  });
});
