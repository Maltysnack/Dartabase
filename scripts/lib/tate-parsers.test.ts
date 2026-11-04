import { describe, expect, test } from "vitest";
import { flipName, rewriteTateImageUrl } from "./tate-parsers";

describe("flipName", () => {
  test("flips 'Surname, Forename' to 'Forename Surname'", () => {
    expect(flipName("Turner, J. M. W.")).toBe("J. M. W. Turner");
    expect(flipName("Hepworth, Barbara")).toBe("Barbara Hepworth");
  });

  test("returns name without comma unchanged", () => {
    expect(flipName("Banksy")).toBe("Banksy");
    expect(flipName("Rembrandt")).toBe("Rembrandt");
  });

  test("trims surrounding whitespace", () => {
    expect(flipName("  Hepworth, Barbara  ")).toBe("Barbara Hepworth");
  });

  test("returns surname only when forename part is empty", () => {
    expect(flipName("Anonymous,")).toBe("Anonymous");
    expect(flipName("Unknown,  ")).toBe("Unknown");
  });

  test("handles multi-word forenames after the comma", () => {
    expect(flipName("Riley, Bridget Louise")).toBe("Bridget Louise Riley");
  });
});

describe("rewriteTateImageUrl", () => {
  test("rewrites http://www.tate.org.uk to media.tate.org.uk", () => {
    expect(
      rewriteTateImageUrl(
        "http://www.tate.org.uk/art/images/work/T/T01/T01001_8.jpg",
      ),
    ).toBe("https://media.tate.org.uk/art/images/work/T/T01/T01001_8.jpg");
  });

  test("rewrites https://www.tate.org.uk to media.tate.org.uk", () => {
    expect(
      rewriteTateImageUrl(
        "https://www.tate.org.uk/art/images/work/N/N00/N00001_8.jpg",
      ),
    ).toBe("https://media.tate.org.uk/art/images/work/N/N00/N00001_8.jpg");
  });

  test("passes through already-correct media.tate.org.uk URLs", () => {
    const url = "https://media.tate.org.uk/art/images/work/T/T01/T01001_8.jpg";
    expect(rewriteTateImageUrl(url)).toBe(url);
  });

  test("returns null for empty/null input", () => {
    expect(rewriteTateImageUrl("")).toBeNull();
    expect(rewriteTateImageUrl(null)).toBeNull();
    expect(rewriteTateImageUrl(undefined)).toBeNull();
  });
});
