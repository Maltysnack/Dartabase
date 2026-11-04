import { describe, expect, it } from "vitest";
import {
  artworkDate,
  deriveMediumBucket,
  imageRightsBadge,
  isPlaceholderArtist,
  normaliseDateText,
  parseTourVenues,
} from "./format";

describe("normaliseDateText", () => {
  it("returns empty for null / empty", () => {
    expect(normaliseDateText(null)).toBe("");
    expect(normaliseDateText("")).toBe("");
    expect(normaliseDateText("   ")).toBe("");
  });

  it("leaves a clean single year alone", () => {
    expect(normaliseDateText("1864")).toBe("1864");
  });

  it("collapses ASCII-hyphen ranges with spaces to en-dash, no spaces", () => {
    expect(normaliseDateText("1868 - 1869")).toBe("1868–1869");
    expect(normaliseDateText("1871 - 1872")).toBe("1871–1872");
  });

  it("collapses ASCII-hyphen ranges without spaces", () => {
    expect(normaliseDateText("1868-1869")).toBe("1868–1869");
  });

  it("leaves already-clean en-dash ranges alone", () => {
    expect(normaliseDateText("1868–1869")).toBe("1868–1869");
    expect(normaliseDateText("c. 1868–73")).toBe("c. 1868–73");
  });

  it("normalises 'ca.' to 'c.'", () => {
    expect(normaliseDateText("ca. 1870")).toBe("c. 1870");
    expect(normaliseDateText("Ca. 1870")).toBe("c. 1870");
  });

  it("handles the combined case: 'ca. YYYY - YYYY'", () => {
    expect(normaliseDateText("ca. 1870 - 1880")).toBe("c. 1870–1880");
  });

  it("preserves colloquial qualifiers", () => {
    expect(normaliseDateText("Early 1887")).toBe("Early 1887");
    expect(normaliseDateText("fall 1906")).toBe("fall 1906");
    expect(normaliseDateText("summer 1909")).toBe("summer 1909");
    expect(normaliseDateText("January–February 1912")).toBe(
      "January–February 1912",
    );
  });

  it("preserves shorthand range like '1868–73'", () => {
    expect(normaliseDateText("c. 1915–26")).toBe("c. 1915–26");
  });

  it("collapses internal whitespace", () => {
    expect(normaliseDateText("1864   ")).toBe("1864");
    expect(normaliseDateText("  c.   1870  ")).toBe("c. 1870");
  });

  it("does not eat a four-digit number adjacent to non-year text", () => {
    expect(normaliseDateText("1905, printed 1913")).toBe(
      "1905, printed 1913",
    );
  });
});

describe("imageRightsBadge", () => {
  it("returns null for empty / null", () => {
    expect(imageRightsBadge(null)).toBe(null);
    expect(imageRightsBadge("")).toBe(null);
  });

  it("classifies explicit CC0 (every source variant)", () => {
    expect(imageRightsBadge("Public Domain (CC0)")).toBe("CC0");
    expect(imageRightsBadge("Minneapolis Institute of Art, CC0")).toBe("CC0");
    expect(imageRightsBadge("Walters Art Museum, CC0")).toBe("CC0");
    expect(imageRightsBadge("Smithsonian, CC0")).toBe("CC0");
  });

  it("classifies public-domain strings without CC0", () => {
    expect(imageRightsBadge("NGA Open Access (public domain)")).toBe(
      "Public domain",
    );
    expect(imageRightsBadge("Public Domain")).toBe("Public domain");
  });

  it("returns null for ambiguous / institution-only / see-source", () => {
    expect(
      imageRightsBadge("The Museum of Modern Art (see source)"),
    ).toBe(null);
    expect(imageRightsBadge("Harvard Art Museums (see source)")).toBe(null);
    expect(imageRightsBadge("Städel Museum")).toBe(null);
    expect(imageRightsBadge("unknown")).toBe(null);
  });

  it("does not false-match 'CC' as 'CC0'", () => {
    expect(imageRightsBadge("CC-BY-SA 4.0")).toBe(null);
  });
});

describe("isPlaceholderArtist", () => {
  it("flags every observed Unknown / Unidentified / Anonymous variant", () => {
    expect(isPlaceholderArtist("Unknown")).toBe(true);
    expect(isPlaceholderArtist("UNKNOWN")).toBe(true);
    expect(isPlaceholderArtist("Unknown Maker")).toBe(true);
    expect(isPlaceholderArtist("Unknown artist")).toBe(true);
    expect(isPlaceholderArtist("Unidentified Artist")).toBe(true);
    expect(isPlaceholderArtist("Unidentified Artists")).toBe(true);
    expect(isPlaceholderArtist("Anonymous Artist")).toBe(true);
    expect(isPlaceholderArtist("Anonymous, German, 16th century")).toBe(true);
  });

  it("flags QAGOMA-style 'after X' attributions", () => {
    expect(isPlaceholderArtist("after UNKNOWN ROMAN")).toBe(true);
    expect(isPlaceholderArtist("after James Charles Armytage")).toBe(true);
  });

  it("flags single-token cultural attributions", () => {
    expect(isPlaceholderArtist("China")).toBe(true);
    expect(isPlaceholderArtist("Egyptian")).toBe(true);
    expect(isPlaceholderArtist("Japanese")).toBe(true);
    expect(isPlaceholderArtist("Greek")).toBe(true);
  });

  it("flags empty / whitespace", () => {
    expect(isPlaceholderArtist("")).toBe(true);
    expect(isPlaceholderArtist("   ")).toBe(true);
  });

  it("does NOT flag real artist names", () => {
    expect(isPlaceholderArtist("Claude Monet")).toBe(false);
    expect(isPlaceholderArtist("Andy Warhol")).toBe(false);
    expect(isPlaceholderArtist("Emily Kame Kngwarreye")).toBe(false);
    expect(isPlaceholderArtist("Gordon Bennett")).toBe(false);
    // First-name-only artists used by some sources; these are real
    expect(isPlaceholderArtist("AY-O")).toBe(false);
  });

  it("does NOT flag cultural words used as part of a longer real name", () => {
    expect(isPlaceholderArtist("China Marks")).toBe(false);
    expect(isPlaceholderArtist("Roman Polanski")).toBe(false);
  });
});

describe("artworkDate", () => {
  it("normalises text when present", () => {
    expect(artworkDate("ca. 1870 - 1880", null)).toBe("c. 1870–1880");
  });

  it("falls back to formatYear when text is empty / whitespace", () => {
    expect(artworkDate(null, 1864)).toBe("1864");
    expect(artworkDate("", 1864)).toBe("1864");
    expect(artworkDate("   ", 1864)).toBe("1864");
  });

  it("falls back through to empty when both are absent", () => {
    expect(artworkDate(null, null)).toBe("");
  });
});

describe("deriveMediumBucket", () => {
  it("returns null for null or empty medium", () => {
    expect(deriveMediumBucket(null)).toBeNull();
    expect(deriveMediumBucket("")).toBeNull();
  });

  it("returns null when no bucket matches", () => {
    expect(deriveMediumBucket("mixed media")).toBeNull();
  });

  it("classifies Video variants", () => {
    expect(deriveMediumBucket("video installation")).toBe("Video");
    expect(deriveMediumBucket("Single-channel video")).toBe("Video");
    expect(deriveMediumBucket("DVD")).toBe("Video");
    expect(deriveMediumBucket("Animation")).toBe("Video");
  });

  it("classifies Installation variants", () => {
    expect(deriveMediumBucket("mixed-media installation")).toBe("Installation");
    expect(deriveMediumBucket("Sound installation")).toBe("Installation");
  });

  it("classifies Painting variants", () => {
    expect(deriveMediumBucket("Oil on canvas")).toBe("Painting");
    expect(deriveMediumBucket("Acrylic on board")).toBe("Painting");
    expect(deriveMediumBucket("Watercolor on paper")).toBe("Painting");
    expect(deriveMediumBucket("Gouache on cardboard")).toBe("Painting");
  });

  it("classifies Print variants", () => {
    expect(deriveMediumBucket("Etching on paper")).toBe("Print");
    expect(deriveMediumBucket("Lithograph")).toBe("Print");
    expect(deriveMediumBucket("Screenprint")).toBe("Print");
    expect(deriveMediumBucket("Woodcut")).toBe("Print");
  });

  it("classifies Drawing variants", () => {
    expect(deriveMediumBucket("Graphite on paper")).toBe("Drawing");
    expect(deriveMediumBucket("Charcoal drawing")).toBe("Drawing");
    expect(deriveMediumBucket("Pencil on paper")).toBe("Drawing");
  });

  it("classifies Photography variants", () => {
    expect(deriveMediumBucket("Gelatin silver print")).toBe("Photography");
    expect(deriveMediumBucket("Chromogenic print")).toBe("Photography");
    expect(deriveMediumBucket("Photograph")).toBe("Photography");
  });

  it("classifies Sculpture variants", () => {
    expect(deriveMediumBucket("Bronze")).toBe("Sculpture");
    expect(deriveMediumBucket("Marble")).toBe("Sculpture");
  });

  it("classifies Ceramics variants", () => {
    expect(deriveMediumBucket("Earthenware")).toBe("Ceramics");
    expect(deriveMediumBucket("Porcelain")).toBe("Ceramics");
    expect(deriveMediumBucket("Stoneware")).toBe("Ceramics");
  });

  it("classifies Textile variants", () => {
    expect(deriveMediumBucket("Wool tapestry")).toBe("Textile");
    expect(deriveMediumBucket("Silk embroidery")).toBe("Textile");
  });

  it("is case-insensitive", () => {
    expect(deriveMediumBucket("OIL ON CANVAS")).toBe("Painting");
    expect(deriveMediumBucket("ETCHING")).toBe("Print");
  });
});

describe("parseTourVenues", () => {
  const TITLE = "Color and Light";

  it("returns null for empty description", () => {
    expect(parseTourVenues(TITLE, "")).toBeNull();
    expect(parseTourVenues(TITLE, TITLE + ".")).toBeNull();
  });

  it("returns null for a single venue (no semicolon)", () => {
    expect(
      parseTourVenues(TITLE, `${TITLE}. Cleveland Museum of Art, Cleveland (January–March 2015)`),
    ).toBeNull();
  });

  it("parses two venues", () => {
    const desc = `${TITLE}. Cleveland Museum of Art, Cleveland (organizer) (January–March 2015); Art Institute of Chicago, Chicago (April–June 2015)`;
    const result = parseTourVenues(TITLE, desc);
    expect(result).toHaveLength(2);
    expect(result![0].venueLocation).toBe("Cleveland Museum of Art, Cleveland");
    expect(result![0].isOrganizer).toBe(true);
    expect(result![0].dates).toBe("January–March 2015");
    expect(result![1].venueLocation).toBe("Art Institute of Chicago, Chicago");
    expect(result![1].isOrganizer).toBe(false);
    expect(result![1].dates).toBe("April–June 2015");
  });

  it("extracts URL from a venue segment", () => {
    const desc = `${TITLE}. Cleveland Museum of Art, Cleveland (January–March 2015) https://example.org/ex; Tate Modern, London (May–August 2015)`;
    const result = parseTourVenues(TITLE, desc);
    expect(result).toHaveLength(2);
    expect(result![0].url).toBe("https://example.org/ex");
    expect(result![1].url).toBeNull();
  });

  it("handles descriptions where the title prefix does not match exactly", () => {
    const desc = `Different Prefix. Venue A, City A (2010); Venue B, City B (2011)`;
    const result = parseTourVenues("Other Title", desc);
    expect(result).toHaveLength(2);
    expect(result![0].venueLocation).toBe("Venue A, City A");
    expect(result![1].venueLocation).toBe("Venue B, City B");
  });

  it("returns null when fewer than 2 non-empty segments remain", () => {
    expect(parseTourVenues(TITLE, `${TITLE}. Only one venue here`)).toBeNull();
  });
});
