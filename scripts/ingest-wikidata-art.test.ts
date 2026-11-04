import { describe, expect, test } from "vitest";
import {
  qid,
  isBareQid,
  yearOf,
  imageUrl,
  mapBinding,
  MUSEUMS,
} from "./ingest-wikidata-art";

const wd = (q: string) => `http://www.wikidata.org/entity/${q}`;
const commons = (f: string) =>
  `http://commons.wikimedia.org/wiki/Special:FilePath/${f}`;

describe("helpers", () => {
  test("qid extracts the trailing id", () => {
    expect(qid(wd("Q51252"))).toBe("Q51252");
  });
  test("isBareQid detects label-service fallbacks", () => {
    expect(isBareQid("Q12345")).toBe(true);
    expect(isBareQid("El Greco")).toBe(false);
    expect(isBareQid("")).toBe(false);
    expect(isBareQid(undefined)).toBe(false);
  });
  test("yearOf extracts a (possibly negative) year", () => {
    expect(yearOf("1610-01-01T00:00:00Z")).toBe(1610);
    expect(yearOf("-0400-01-01T00:00:00Z")).toBe(-400);
    expect(yearOf(undefined)).toBeNull();
  });
  test("imageUrl upgrades to https and a display width", () => {
    expect(imageUrl(commons("Foo.jpg"))).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Foo.jpg?width=800",
    );
  });
});

describe("mapBinding", () => {
  const full = {
    artwork: { value: wd("Q104772137") },
    artworkLabel: { value: "Tears of Saint Peter" },
    creator: { value: wd("Q301") },
    creatorLabel: { value: "El Greco" },
    inception: { value: "1610-01-01T00:00:00Z" },
    image: { value: commons("ElGreco.jpg") },
    copyrightLabel: { value: "public domain" },
    materials: { value: "oil paint, canvas" },
    h: { value: "163" },
    w: { value: "125.5" },
  };

  test("maps a full record with a named artist, medium and dimensions", () => {
    const m = mapBinding(full, "uffizi");
    expect(m).not.toBeNull();
    expect(m!.artwork).toMatchObject({
      source: "uffizi",
      source_id: "Q104772137",
      title: "Tears of Saint Peter",
      date_year: 1610,
      medium: "oil paint, canvas",
      dimensions: "163 × 125.5 cm",
      image_url: "https://commons.wikimedia.org/wiki/Special:FilePath/ElGreco.jpg?width=800",
      image_license: "public domain",
      source_url: "https://www.wikidata.org/wiki/Q104772137",
      wikidata_id: "Q104772137",
      artist_source_id: "Q301",
    });
    expect(m!.artist).toMatchObject({
      source_id: "Q301",
      name: "El Greco",
      wikidata_id: "Q301",
    });
  });

  test("medium and dimensions are null when their fields are absent/partial", () => {
    const m = mapBinding(
      { ...full, materials: { value: "" }, h: { value: "163" }, w: undefined },
      "uffizi",
    );
    expect(m!.artwork.medium).toBeNull();
    expect(m!.artwork.dimensions).toBeNull(); // width missing -> no dimensions
  });

  test("drops rows with no title, a bare-QID title, or no image", () => {
    expect(mapBinding({ ...full, artworkLabel: undefined }, "uffizi")).toBeNull();
    expect(mapBinding({ ...full, artworkLabel: { value: "Q999" } }, "uffizi")).toBeNull();
    expect(mapBinding({ ...full, image: undefined }, "uffizi")).toBeNull();
  });

  test("keeps the artwork but no artist when the creator is anonymous/unlabelled", () => {
    const m = mapBinding({ ...full, creator: undefined, creatorLabel: undefined }, "uffizi");
    expect(m!.artwork.artist_source_id).toBeNull();
    expect(m!.artist).toBeNull();
    const m2 = mapBinding({ ...full, creatorLabel: { value: "Q777" } }, "uffizi");
    expect(m2!.artist).toBeNull();
  });

  test("falls back to a Commons licence label when copyright is absent", () => {
    const m = mapBinding({ ...full, copyrightLabel: undefined }, "uffizi");
    expect(m!.artwork.image_license).toBe("Wikimedia Commons");
  });
});

describe("MUSEUMS config", () => {
  test("every museum has a matching source and a valid collection QID", () => {
    expect(Object.keys(MUSEUMS).length).toBeGreaterThanOrEqual(20);
    for (const [key, cfg] of Object.entries(MUSEUMS)) {
      expect(cfg.source).toBe(key);
      expect(cfg.institution.source).toBe(key);
      expect(cfg.institution.source_id).toBe(`institution:${key}`);
      expect(cfg.collectionQid).toMatch(/^Q\d+$/);
      expect(cfg.institution.name.length).toBeGreaterThan(0);
    }
  });

  test("spot-checks: known QIDs and details are intact", () => {
    expect(MUSEUMS.uffizi.collectionQid).toBe("Q51252");
    expect(MUSEUMS.frick.institution.city).toBe("New York");
    expect(MUSEUMS["nationalmuseum-se"].institution.country).toBe("Sweden");
  });
});

describe("mapBinding metadata-only", () => {
  const row = {
    artwork: { value: wd("Q1") },
    artworkLabel: { value: "Untitled" },
    creator: { value: wd("Q2") },
    creatorLabel: { value: "An Artist" },
    image: { value: commons("x.jpg") },
  };

  test("keeps imageless works and drops the image even when one exists", () => {
    const noImg = { ...row, image: undefined };
    const m = mapBinding(noImg, "ngv", true);
    expect(m?.artwork.image_url).toBeNull();
    expect(mapBinding(row, "ngv", true)?.artwork.image_url).toBeNull();
    expect(mapBinding(noImg, "ngv")).toBeNull();
  });
});
