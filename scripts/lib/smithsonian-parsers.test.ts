import { describe, expect, test } from "vitest";
import {
  artistSourceIdFromName,
  parseArtistField,
} from "./smithsonian-parsers";

describe("artistSourceIdFromName (smithsonian)", () => {
  test("produces a slug identical to MIA's for common names", () => {
    // The implementation is duplicated across MIA and Smithsonian so the
    // dedup similarity matcher sees the same slug on both sides. If these
    // drift, cross-source artist folding silently misses pairs.
    expect(artistSourceIdFromName("Pablo Picasso")).toBe("pablo-picasso");
    expect(artistSourceIdFromName("Édouard Manet")).toBe("edouard-manet");
    expect(artistSourceIdFromName("Jean-Auguste-Dominique Ingres")).toBe(
      "jean-auguste-dominique-ingres",
    );
  });
});

describe("parseArtistField", () => {
  test("name-only (no commas)", () => {
    expect(parseArtistField("Pablo Picasso")).toEqual({
      name: "Pablo Picasso",
      birth: null,
      death: null,
      nationality: null,
    });
    expect(parseArtistField("Unknown")).toEqual({
      name: "Unknown",
      birth: null,
      death: null,
      nationality: null,
    });
  });

  test("'Name, Demonym, YYYY-YYYY' shape", () => {
    expect(parseArtistField("Pablo Picasso, Spanish, 1881-1973")).toEqual({
      name: "Pablo Picasso",
      birth: 1881,
      death: 1973,
      nationality: "Spanish",
    });
  });

  test("'Name, Demonym, b. Place, YYYY-YYYY' shape (Dürer-style)", () => {
    expect(
      parseArtistField("Albrecht Dürer, German, b. Nuremberg, 1471–1528"),
    ).toEqual({
      name: "Albrecht Dürer",
      birth: 1471,
      death: 1528,
      nationality: "German",
    });
  });

  test("'Name, born Place YYYY-died Place YYYY' shape (no nationality)", () => {
    expect(
      parseArtistField(
        "Arthur A. Marschner, born Detroit, MI 1884-died Detroit, MI 1950",
      ),
    ).toEqual({
      name: "Arthur A. Marschner",
      birth: 1884,
      death: 1950,
      // "born Detroit" is not a demonym; the defensive regex catches this.
      nationality: null,
    });
  });

  test("hyphenated demonyms are preserved", () => {
    expect(parseArtistField("Frida Kahlo, Mexican-American, 1907-1954")).toEqual(
      {
        name: "Frida Kahlo",
        birth: 1907,
        death: 1954,
        nationality: "Mexican-American",
      },
    );
  });

  test("slash demonyms are preserved (e.g. 'British/American')", () => {
    expect(parseArtistField("Whistler, British/American, 1834-1903")).toEqual({
      name: "Whistler",
      birth: 1834,
      death: 1903,
      nationality: "British/American",
    });
  });

  test("birth-only when only one year is present", () => {
    expect(parseArtistField("Living Artist, American, b. 1944")).toEqual({
      name: "Living Artist",
      birth: 1944,
      death: null,
      nationality: "American",
    });
  });

  test("'circa' and 'active' are not demonyms", () => {
    // The defensive token regex catches dating-language tokens that would
    // otherwise capitalise like demonyms.
    expect(parseArtistField("Some Artist, ca. 1500-1550")).toEqual({
      name: "Some Artist",
      birth: 1500,
      death: 1550,
      nationality: null,
    });
    expect(parseArtistField("Another, active 1879-1890")).toEqual({
      name: "Another",
      birth: 1879,
      death: 1890,
      nationality: null,
    });
  });

  test("first three-digit run is captured for ancient artists", () => {
    expect(parseArtistField("Roman, Roman, ca. 100-150 CE")).toEqual({
      name: "Roman",
      birth: 100,
      death: 150,
      nationality: "Roman",
    });
  });

  test("trims input", () => {
    expect(parseArtistField("  Pablo Picasso  ")).toEqual({
      name: "Pablo Picasso",
      birth: null,
      death: null,
      nationality: null,
    });
  });
});
