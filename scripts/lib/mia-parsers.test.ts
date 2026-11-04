import { describe, expect, test } from "vitest";
import {
  artistSourceIdFromName,
  parseLifeDate,
  primaryArtistName,
} from "./mia-parsers";

describe("primaryArtistName", () => {
  test("returns null for missing input", () => {
    expect(primaryArtistName(null)).toBe(null);
    expect(primaryArtistName(undefined)).toBe(null);
    expect(primaryArtistName("")).toBe(null);
    expect(primaryArtistName("   ")).toBe(null);
  });

  test("returns clean single-maker names verbatim", () => {
    expect(primaryArtistName("Frederick G. Smith")).toBe("Frederick G. Smith");
    expect(primaryArtistName("  Pablo Picasso  ")).toBe("Pablo Picasso");
  });

  test("strips 'artist:' prefix when present", () => {
    expect(primaryArtistName("artist: Pablo Picasso")).toBe("Pablo Picasso");
    expect(primaryArtistName("Artist: Pablo Picasso")).toBe("Pablo Picasso");
    expect(primaryArtistName("ARTIST: Pablo Picasso")).toBe("Pablo Picasso");
  });

  test("takes the first maker from a semicolon-joined list", () => {
    expect(
      primaryArtistName("artist: Smith; artist: Formerly attributed to Rossetti"),
    ).toBe("Smith");
    expect(primaryArtistName("Smith; Rossetti")).toBe("Smith");
  });

  test("returns null when first segment is empty after prefix strip", () => {
    expect(primaryArtistName("artist: ; artist: Picasso")).toBe(null);
  });
});

describe("artistSourceIdFromName", () => {
  test("lowercases and hyphenates", () => {
    expect(artistSourceIdFromName("Pablo Picasso")).toBe("pablo-picasso");
    expect(artistSourceIdFromName("Frederick G. Smith")).toBe("frederick-g-smith");
  });

  test("strips diacritics so accented and unaccented names collide", () => {
    expect(artistSourceIdFromName("Paul Cézanne")).toBe("paul-cezanne");
    expect(artistSourceIdFromName("Paul Cezanne")).toBe("paul-cezanne");
    expect(artistSourceIdFromName("Édouard Manet")).toBe("edouard-manet");
  });

  test("collapses multiple non-alphanumeric runs into single hyphens", () => {
    expect(artistSourceIdFromName("Jean-Auguste-Dominique Ingres")).toBe(
      "jean-auguste-dominique-ingres",
    );
    expect(artistSourceIdFromName("M.C. Escher")).toBe("m-c-escher");
  });

  test("trims leading and trailing hyphens", () => {
    expect(artistSourceIdFromName("--Picasso--")).toBe("picasso");
    expect(artistSourceIdFromName("  Picasso  ")).toBe("picasso");
  });

  test("is stable across whitespace and punctuation variations", () => {
    const a = artistSourceIdFromName("Pablo  Picasso");
    const b = artistSourceIdFromName("Pablo Picasso");
    const c = artistSourceIdFromName("PABLO PICASSO");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe("parseLifeDate", () => {
  test("returns null fields for missing input", () => {
    expect(parseLifeDate(null)).toEqual({
      nationality: null,
      birth: null,
      death: null,
    });
    expect(parseLifeDate("")).toEqual({
      nationality: null,
      birth: null,
      death: null,
    });
    expect(parseLifeDate("   ")).toEqual({
      nationality: null,
      birth: null,
      death: null,
    });
  });

  test("parses 'Nationality, YYYY-YYYY' shape", () => {
    expect(parseLifeDate("American, 1864-1944")).toEqual({
      nationality: "American",
      birth: 1864,
      death: 1944,
    });
    expect(parseLifeDate("Spanish, 1881-1973")).toEqual({
      nationality: "Spanish",
      birth: 1881,
      death: 1973,
    });
  });

  test("parses 'Nationality (active YYYY-YYYY)' shape", () => {
    expect(parseLifeDate("British (active 1879-1890)")).toEqual({
      nationality: "British",
      birth: 1879,
      death: 1890,
    });
  });

  test("captures multi-word nationalities", () => {
    expect(parseLifeDate("Native American, 1900-1980")).toEqual({
      nationality: "Native American",
      birth: 1900,
      death: 1980,
    });
  });

  test("captures hyphenated nationalities", () => {
    expect(parseLifeDate("French-Canadian, 1900-1980")).toEqual({
      nationality: "French-Canadian",
      birth: 1900,
      death: 1980,
    });
  });

  test("handles a single year (still living, or only birth known)", () => {
    expect(parseLifeDate("American, 1944")).toEqual({
      nationality: "American",
      birth: 1944,
      death: null,
    });
  });

  test("handles no years (nationality only)", () => {
    expect(parseLifeDate("American")).toEqual({
      nationality: "American",
      birth: null,
      death: null,
    });
  });

  test("handles years with no nationality", () => {
    expect(parseLifeDate("1864-1944")).toEqual({
      nationality: null,
      birth: 1864,
      death: 1944,
    });
  });

  test("ignores years past the second one", () => {
    // If MIA ever supplies "active 1879-1890, died 1900", only the first two
    // four-digit runs are captured.
    expect(parseLifeDate("British (active 1879-1890), died 1900")).toEqual({
      nationality: "British",
      birth: 1879,
      death: 1890,
    });
  });
});
