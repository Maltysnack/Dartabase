import { describe, expect, test } from "vitest";
import { lifeYears } from "./harvard-parsers";

describe("lifeYears", () => {
  test("returns null fields for missing input", () => {
    expect(lifeYears(undefined)).toEqual({ birth: null, death: null });
    expect(lifeYears(null)).toEqual({ birth: null, death: null });
    expect(lifeYears("")).toEqual({ birth: null, death: null });
  });

  test("returns null fields when no year present", () => {
    expect(lifeYears("active")).toEqual({ birth: null, death: null });
    expect(lifeYears("born unknown")).toEqual({ birth: null, death: null });
  });

  test("parses Harvard's canonical 'YYYY - YYYY' format", () => {
    expect(lifeYears("1853 - 1890")).toEqual({ birth: 1853, death: 1890 });
    expect(lifeYears("1881 - 1973")).toEqual({ birth: 1881, death: 1973 });
  });

  test("parses 'YYYY-YYYY' with no spaces", () => {
    expect(lifeYears("1864-1944")).toEqual({ birth: 1864, death: 1944 });
  });

  test("birth-only when only one year is present", () => {
    expect(lifeYears("1944")).toEqual({ birth: 1944, death: null });
    expect(lifeYears("b. 1944")).toEqual({ birth: 1944, death: null });
  });

  test("captures the first two year-shaped runs from longer strings", () => {
    expect(lifeYears("active 1879-1890")).toEqual({
      birth: 1879,
      death: 1890,
    });
    expect(lifeYears("Born 1853, died 1890")).toEqual({
      birth: 1853,
      death: 1890,
    });
  });

  test("ignores years past the second one", () => {
    // If Harvard ever supplies "1853 - 1890, lived in Paris 1875-1885", only
    // the first two four-digit runs are captured.
    expect(lifeYears("1853 - 1890, in Paris 1875-1885")).toEqual({
      birth: 1853,
      death: 1890,
    });
  });

  test("three-digit years pass through (medieval / ancient artists)", () => {
    expect(lifeYears("c. 850 - 920")).toEqual({ birth: 850, death: 920 });
  });
});
