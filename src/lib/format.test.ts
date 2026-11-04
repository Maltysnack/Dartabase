import { describe, expect, it } from "vitest";
import {
  artworkDate,
  normaliseDateText,
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

