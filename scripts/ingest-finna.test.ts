import { describe, expect, test } from "vitest";
import {
  isOpenLicence,
  parsePerson,
  parseMedium,
  parseDimensions,
  parseYear,
  mapRecord,
  MUSEUMS,
  type FinnaRecord,
} from "./ingest-finna";

describe("isOpenLicence", () => {
  test("accepts open licences", () => {
    for (const c of ["CC0", "CC0 1.0", "CC BY 4.0", "CC BY-SA 4.0", "PDM", "Public domain"]) {
      expect(isOpenLicence(c)).toBe(true);
    }
  });
  test("rejects in-copyright and NC/ND variants", () => {
    for (const c of ["InC", "CC BY-NC 4.0", "CC BY-NC-SA 4.0", "CC BY-ND 4.0", "", undefined]) {
      expect(isOpenLicence(c)).toBe(false);
    }
  });
});

describe("parsePerson", () => {
  test("inverts Surname, Given", () => {
    expect(parsePerson("Villon, Jacques")).toEqual({
      name: "Jacques Villon",
      sortName: "Villon, Jacques",
    });
  });
  test("single name keeps as-is, empty is null", () => {
    expect(parsePerson("Anonymous")).toEqual({ name: "Anonymous", sortName: null });
    expect(parsePerson("")).toBeNull();
  });
});

describe("parseMedium", () => {
  test("maps WorkOfArt sub-format", () => {
    expect(parseMedium([{ value: "0/WorkOfArt/" }, { value: "1/WorkOfArt/Painting/" }])).toBe("Painting");
    expect(parseMedium([{ value: "1/WorkOfArt/Graphic/" }])).toBe("Print");
  });
  test("falls back to the raw token, null when absent", () => {
    expect(parseMedium([{ value: "1/WorkOfArt/Textile/" }])).toBe("Textile");
    expect(parseMedium([{ value: "0/WorkOfArt/" }])).toBeNull();
    expect(parseMedium(undefined)).toBeNull();
  });
});

describe("parseDimensions", () => {
  test("strips the Finnish label prefix", () => {
    expect(parseDimensions(["teosmitat: 15,5 x 24,5 cm"])).toBe("15,5 x 24,5 cm");
  });
  test("null when no measurement or no digits", () => {
    expect(parseDimensions([])).toBeNull();
    expect(parseDimensions(["tuntematon"])).toBeNull();
  });
});

describe("parseYear", () => {
  test("extracts a 4-digit year", () => {
    expect(parseYear("1944")).toBe(1944);
    expect(parseYear("ca 1850")).toBe(1850);
    expect(parseYear("n.d.")).toBeNull();
  });
});

describe("mapRecord", () => {
  const base: FinnaRecord = {
    id: "kansallisgalleria.abc",
    title: "Sininen vuori",
    year: "1944",
    nonPresenterAuthors: [{ name: "Villon, Jacques" }],
    images: ["/Cover/Show?id=kansallisgalleria.abc&index=0&size=large"],
    imageRights: { copyright: "CC0" },
    formats: [{ value: "1/WorkOfArt/Painting/" }],
    measurements: ["teosmitat: 50 x 60 cm"],
  };

  test("maps an open-licensed record with image and artist", () => {
    const m = mapRecord(base, "kiasma");
    expect(m).not.toBeNull();
    expect(m!.artwork).toMatchObject({
      source: "kiasma",
      source_id: "kansallisgalleria.abc",
      title: "Sininen vuori",
      date_year: 1944,
      medium: "Painting",
      dimensions: "50 x 60 cm",
      image_url: "https://api.finna.fi/Cover/Show?id=kansallisgalleria.abc&index=0&size=large",
      image_license: "CC0",
    });
    expect(m!.artwork.source_url).toBe(
      "https://www.finna.fi/Record/kansallisgalleria.abc",
    );
    expect(m!.artist).toMatchObject({ name: "Jacques Villon", sort_name: "Villon, Jacques" });
  });

  test("withholds the image when in-copyright (metadata-only)", () => {
    const m = mapRecord({ ...base, imageRights: { copyright: "InC" } }, "kiasma");
    expect(m!.artwork.image_url).toBeNull();
    expect(m!.artwork.image_license).toBeNull();
  });

  test("drops records with no title or no author", () => {
    expect(mapRecord({ ...base, title: "" }, "kiasma")).toBeNull();
    expect(mapRecord({ ...base, nonPresenterAuthors: [] }, "kiasma")).toBeNull();
  });
});

describe("MUSEUMS config", () => {
  test("all Finnish art museums are configured", () => {
    expect(Object.keys(MUSEUMS).sort()).toEqual([
      "gallenkallela",
      "kiasma",
      "serlachius",
      "sinebrychoff",
    ]);
    expect(MUSEUMS.kiasma.building).toContain("Kiasma");
    expect(MUSEUMS.sinebrychoff.building).toContain("Sinebrychoff");
    expect(MUSEUMS.serlachius.building).toContain("Serlachiuksen");
    expect(MUSEUMS.gallenkallela.building).toContain("GallenKallela");
  });
  test("every museum's source matches its key and institution", () => {
    for (const [key, cfg] of Object.entries(MUSEUMS)) {
      expect(cfg.source).toBe(key);
      expect(cfg.institution.source).toBe(key);
    }
  });
});
