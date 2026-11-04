import { describe, expect, test } from "vitest";
import {
  bibtex,
  buildCitation,
  buildExhibitionCitation,
  citationToText,
  ris,
  type CiteExhibition,
  type CitationStyle,
  type ExhibitionCiteable,
} from "./cite";
import type { Artist, ArtworkFull, Institution } from "./types";

function makeArtist(overrides: Partial<Artist> = {}): Artist {
  return {
    id: "a1",
    name: "Pablo Picasso",
    slug: null,
    sort_name: "Picasso, Pablo",
    also_known_as: [],
    birth_year: 1881,
    death_year: 1973,
    nationality: "Spanish",
    gender: null,
    bio: null,
    wikidata_id: null,
    gnd_id: null,
    image_url: null,
    movements: [],
    source: "test",
    source_url: null,
    website_url: null,
    wikipedia_url: null,
    gallery_url: null,
    merged_into: null,
    ...overrides,
  };
}

function makeInstitution(overrides: Partial<Institution> = {}): Institution {
  return {
    id: "i1",
    name: "Museum of Modern Art",
    slug: null,
    type: "art museum",
    city: "New York",
    country: "United States",
    founded_year: null,
    acronyms: [],
    website: null,
    wikidata_id: null,
    source: "test",
    source_url: null,
    merged_into: null,
    ...overrides,
  };
}

function makeArtwork(overrides: Partial<ArtworkFull> = {}): ArtworkFull {
  const base: ArtworkFull = {
    id: "w1",
    slug: null,
    title: "Les Demoiselles d'Avignon",
    artist_id: "a1",
    date_text: "1907",
    date_year: 1907,
    medium: "oil on canvas",
    materials: [],
    dimensions: null,
    current_institution_id: "i1",
    credit_line: null,
    image_url: null,
    image_license: null,
    wikidata_id: null,
    cultural_notice: false,
    cultural_attribution: null,
    department: null,
    classification: null,
    source: "test",
    source_id: null,
    source_url: null,
    iiif_manifest_url: null,
    artist: makeArtist(),
    institution: makeInstitution(),
  };
  return { ...base, ...overrides };
}

function cite(style: CitationStyle, artwork: ArtworkFull, ex?: CiteExhibition): string {
  return citationToText(buildCitation(style, artwork, ex));
}

describe("buildCitation: happy path", () => {
  const artwork = makeArtwork();

  test("chicago", () => {
    expect(cite("chicago", artwork)).toMatchInlineSnapshot(
      `"Pablo Picasso, Les Demoiselles d'Avignon, 1907, oil on canvas, Museum of Modern Art, New York."`,
    );
  });

  test("mla", () => {
    expect(cite("mla", artwork)).toMatchInlineSnapshot(
      `"Picasso, Pablo. Les Demoiselles d'Avignon. 1907, Museum of Modern Art, New York."`,
    );
  });

  test("apa", () => {
    expect(cite("apa", artwork)).toMatchInlineSnapshot(
      `"Picasso, P. (1907). Les Demoiselles d'Avignon [oil on canvas]. Museum of Modern Art, New York."`,
    );
  });

  test("harvard", () => {
    expect(cite("harvard", artwork)).toMatchInlineSnapshot(
      `"Picasso, P. (1907) Les Demoiselles d'Avignon. [oil on canvas]. Museum of Modern Art, New York."`,
    );
  });
});

describe("harvard style specifics", () => {
  test("undated work uses (n.d.)", () => {
    const undated = makeArtwork({ date_text: null, date_year: null });
    expect(cite("harvard", undated)).toContain("(n.d.)");
  });

  test("differs from APA: no period after the year, medium is its own element", () => {
    const artwork = makeArtwork();
    // APA: "... (1907). Title [medium]."   Harvard: "... (1907) Title. [medium]."
    expect(cite("harvard", artwork)).toContain("(1907) Les Demoiselles");
    expect(cite("harvard", artwork)).toContain(". [oil on canvas].");
  });

  test("attribution phrase is cited whole", () => {
    const artwork = makeArtwork({
      artist: makeArtist({
        name: "Attributed to Pablo Picasso",
        sort_name: "Picasso, Pablo",
      }),
    });
    expect(cite("harvard", artwork)).toContain(
      "Attributed to Pablo Picasso (1907)",
    );
  });

  test("omits medium and repository when absent", () => {
    const artwork = makeArtwork({ medium: null, institution: null });
    const out = cite("harvard", artwork);
    expect(out).not.toContain("[");
    expect(out).toBe("Picasso, P. (1907) Les Demoiselles d'Avignon.");
  });

  test("standalone exhibition citation", () => {
    const exhibition: ExhibitionCiteable = {
      title: "Cézanne",
      start_date: "1996-05-30",
      end_date: "1996-08-18",
      institution: { name: "Tate Gallery", city: "London" },
    };
    const out = citationToText(
      buildExhibitionCitation("harvard", exhibition, "https://dartabase.app/x"),
    );
    expect(out).toBe(
      "Tate Gallery (1996) Cézanne [Exhibition]. London. Available at: https://dartabase.app/x.",
    );
  });
});

describe("untitled works", () => {
  test.each([
    ["null title", null],
    ["empty string", ""],
    ["literal Untitled", "Untitled"],
    ["bracketed [Untitled] (does not double)", "[Untitled]"],
    ["case-insensitive UNTITLED", "UNTITLED"],
  ])("%s renders as [Untitled] in Chicago", (_label, rawTitle) => {
    const artwork = makeArtwork({ title: rawTitle as string });
    expect(cite("chicago", artwork)).toContain("[Untitled]");
    expect(cite("chicago", artwork)).not.toContain("[[Untitled]]");
  });

  test("[Untitled] is not italicised in MLA (no italic part for it)", () => {
    const artwork = makeArtwork({ title: null as unknown as string });
    const parts = buildCitation("mla", artwork);
    const titlePart = parts.find((p) => p.text === "[Untitled]");
    expect(titlePart).toBeDefined();
    expect(titlePart?.italic).toBeFalsy();
  });
});

describe("undated works", () => {
  const undated = makeArtwork({ date_text: null, date_year: null });

  test("chicago renders n.d. with single terminal period", () => {
    const out = cite("chicago", undated);
    expect(out).toContain("n.d.");
    expect(out).not.toMatch(/n\.d\.\./);
    expect(out.endsWith("n.d.")).toBe(false);
    // Chicago tail is ", n.d., oil on canvas, ..."
    expect(out).toBe(
      "Pablo Picasso, Les Demoiselles d'Avignon, n.d., oil on canvas, Museum of Modern Art, New York.",
    );
  });

  test("mla renders n.d. with single terminal period", () => {
    const out = cite("mla", undated);
    expect(out).toContain("n.d.");
    expect(out).not.toMatch(/n\.d\.\./);
    expect(out).toBe(
      "Picasso, Pablo. Les Demoiselles d'Avignon. n.d., Museum of Modern Art, New York.",
    );
  });

  test("apa wraps as (n.d.) and never doubles period", () => {
    const out = cite("apa", undated);
    expect(out).toContain("(n.d.)");
    expect(out).not.toMatch(/n\.d\.\.\)/);
    expect(out).toBe(
      "Picasso, P. (n.d.). Les Demoiselles d'Avignon [oil on canvas]. Museum of Modern Art, New York.",
    );
  });
});

describe("attribution prefixes are cited whole", () => {
  const cases = [
    "Attributed to Rembrandt van Rijn",
    "After Caravaggio",
    "Follower of Rubens",
    "Workshop of Rembrandt van Rijn",
    "Circle of Bellini",
    "Manner of Vermeer",
    "School of Fontainebleau",
    "Imitator of Goya",
    "Studio of Rubens",
    "Copy after Titian",
    "Formerly attributed to Bosch",
  ];

  test.each(cases)("%s: chicago does not invert", (name) => {
    const artwork = makeArtwork({
      artist: makeArtist({ name, sort_name: "Rijn, Rembrandt van" }),
    });
    expect(cite("chicago", artwork)).toContain(name);
  });

  test.each(cases)("%s: mla does not invert", (name) => {
    const artwork = makeArtwork({
      artist: makeArtist({ name, sort_name: "Rijn, Rembrandt van" }),
    });
    expect(cite("mla", artwork)).toContain(name);
    expect(cite("mla", artwork)).not.toContain("Rijn,");
  });

  test.each(cases)("%s: apa does not collapse to initials", (name) => {
    const artwork = makeArtwork({
      artist: makeArtist({ name, sort_name: "Rijn, Rembrandt van" }),
    });
    const out = cite("apa", artwork);
    expect(out).toContain(name);
    // APA-collapsed form would be "Rijn, R. v."; must not appear.
    expect(out).not.toMatch(/Rijn, R\./);
  });

  test("case-insensitive prefix detection", () => {
    const artwork = makeArtwork({
      artist: makeArtist({ name: "ATTRIBUTED TO Rembrandt", sort_name: "Rijn, Rembrandt van" }),
    });
    expect(cite("mla", artwork)).toContain("ATTRIBUTED TO Rembrandt");
  });
});

describe("firm or culture names (no comma in sort_name)", () => {
  test("not inverted in MLA, not collapsed in APA", () => {
    const artwork = makeArtwork({
      artist: makeArtist({ name: "Baccarat Glassworks", sort_name: "Baccarat Glassworks" }),
    });
    expect(cite("mla", artwork)).toContain("Baccarat Glassworks. ");
    expect(cite("apa", artwork)).toContain("Baccarat Glassworks ");
  });
});

describe("optional clauses", () => {
  test("no institution: clause omitted across all styles", () => {
    const artwork = makeArtwork({ institution: null });
    expect(cite("chicago", artwork)).toBe(
      "Pablo Picasso, Les Demoiselles d'Avignon, 1907, oil on canvas.",
    );
    expect(cite("mla", artwork)).toBe(
      "Picasso, Pablo. Les Demoiselles d'Avignon. 1907.",
    );
    expect(cite("apa", artwork)).toBe(
      "Picasso, P. (1907). Les Demoiselles d'Avignon [oil on canvas].",
    );
  });

  test("no medium: chicago skips it cleanly", () => {
    const artwork = makeArtwork({ medium: null });
    expect(cite("chicago", artwork)).toBe(
      "Pablo Picasso, Les Demoiselles d'Avignon, 1907, Museum of Modern Art, New York.",
    );
  });

  test("no medium: apa omits brackets", () => {
    const artwork = makeArtwork({ medium: null });
    expect(cite("apa", artwork)).toBe(
      "Picasso, P. (1907). Les Demoiselles d'Avignon. Museum of Modern Art, New York.",
    );
  });

  test("institution without city: only name in the clause", () => {
    const artwork = makeArtwork({
      institution: makeInstitution({ city: null }),
    });
    expect(cite("chicago", artwork)).toContain("Museum of Modern Art.");
    expect(cite("chicago", artwork)).not.toContain("Museum of Modern Art, ,");
  });
});

describe("exhibition appendix", () => {
  test("appends 'Exhibited in' with venue and dates", () => {
    const artwork = makeArtwork();
    const ex: CiteExhibition = {
      title: "Picasso: A Retrospective",
      venue: "Museum of Modern Art",
      dates: "1980",
    };
    expect(cite("chicago", artwork, ex)).toBe(
      "Pablo Picasso, Les Demoiselles d'Avignon, 1907, oil on canvas, Museum of Modern Art, New York. Exhibited in Picasso: A Retrospective, Museum of Modern Art, 1980.",
    );
  });

  test("exhibition with null venue and dates ends in a single period", () => {
    const artwork = makeArtwork();
    const ex: CiteExhibition = {
      title: "Picasso: A Retrospective",
      venue: null,
      dates: null,
    };
    const out = cite("chicago", artwork, ex);
    expect(out).toContain("Exhibited in Picasso: A Retrospective.");
    expect(out).not.toMatch(/Retrospective\.\./);
  });

  test("exhibition title is italicised", () => {
    const artwork = makeArtwork();
    const parts = buildCitation("chicago", artwork, {
      title: "Picasso: A Retrospective",
      venue: null,
      dates: null,
    });
    const titlePart = parts.find((p) => p.text === "Picasso: A Retrospective");
    expect(titlePart?.italic).toBe(true);
  });
});

describe("combined edge cases", () => {
  test("untitled + undated + attribution + no institution", () => {
    const artwork = makeArtwork({
      title: null as unknown as string,
      date_text: null,
      date_year: null,
      medium: null,
      institution: null,
      artist: makeArtist({
        name: "Workshop of Rembrandt",
        sort_name: "Rijn, Rembrandt van",
      }),
    });
    expect(cite("chicago", artwork)).toBe("Workshop of Rembrandt, [Untitled], n.d.");
    expect(cite("mla", artwork)).toBe("Workshop of Rembrandt. [Untitled]. n.d.");
    expect(cite("apa", artwork)).toBe("Workshop of Rembrandt (n.d.). [Untitled].");
  });

  test("no artist at all (anonymous from culture)", () => {
    const artwork = makeArtwork({ artist: null });
    expect(cite("chicago", artwork)).toBe(
      "Les Demoiselles d'Avignon, 1907, oil on canvas, Museum of Modern Art, New York.",
    );
  });
});

describe("date_text wins over date_year", () => {
  test("uses source text when present", () => {
    const artwork = makeArtwork({ date_text: "1907 (cast 1950)", date_year: 1907 });
    expect(cite("chicago", artwork)).toContain("1907 (cast 1950)");
  });

  test("falls back to year when text is missing", () => {
    const artwork = makeArtwork({ date_text: null, date_year: 1907 });
    expect(cite("chicago", artwork)).toContain(", 1907,");
  });

  test("apa always uses the structured year, not date_text", () => {
    const artwork = makeArtwork({ date_text: "1907 (cast 1950)", date_year: 1907 });
    expect(cite("apa", artwork)).toContain("(1907).");
    expect(cite("apa", artwork)).not.toContain("cast 1950");
  });
});

describe("bibtex", () => {
  const CITE_URL = "https://dartabase.art/cite/test/abc123";

  test("produces @misc entry with key, author, title, year", () => {
    // key uses source + id (source_id is null in fixture so falls back to id "w1")
    const artwork = makeArtwork({ date_year: 1907 });
    const out = bibtex(artwork, CITE_URL);
    expect(out).toMatch(/^@misc\{test_w1,/);
    expect(out).toContain("author    = {Picasso, Pablo}");
    expect(out).toContain("title     = {{Les Demoiselles d'Avignon}}");
    expect(out).toContain("year      = {1907}");
    expect(out).toContain(`url       = {${CITE_URL}}`);
  });

  test("omits author when artist is null", () => {
    const artwork = makeArtwork({ artist: null });
    const out = bibtex(artwork, CITE_URL);
    expect(out).not.toContain("author");
  });

  test("omits year when date_year is null", () => {
    const artwork = makeArtwork({ date_year: null });
    const out = bibtex(artwork, CITE_URL);
    expect(out).not.toContain("year");
  });
});

describe("ris", () => {
  const CITE_URL = "https://dartabase.art/cite/test/abc123";

  test("produces TY=ART entry with author, title, year, institution", () => {
    const artwork = makeArtwork({ date_year: 1907 });
    const out = ris(artwork, CITE_URL);
    expect(out).toContain("TY  - ART");
    expect(out).toContain("AU  - Picasso, Pablo");
    expect(out).toContain("TI  - Les Demoiselles d'Avignon");
    expect(out).toContain("PY  - 1907");
    expect(out).toContain("PB  - Museum of Modern Art");
    expect(out).toContain(`UR  - ${CITE_URL}`);
    expect(out).toContain("ER  - ");
  });

  test("omits AU when artist is null", () => {
    const artwork = makeArtwork({ artist: null });
    const out = ris(artwork, CITE_URL);
    expect(out).not.toContain("AU  -");
  });
});
