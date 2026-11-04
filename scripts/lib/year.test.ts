import { describe, expect, test } from "vitest";
import { yearFromText } from "./year";

describe("yearFromText", () => {
  test("plain CE year passes through", () => {
    expect(yearFromText("1907")).toBe(1907);
    expect(yearFromText("c. 1850")).toBe(1850);
    expect(yearFromText("ca. 1920–1925")).toBe(1920);
  });

  test("returns null for empty / missing input", () => {
    expect(yearFromText(null)).toBe(null);
    expect(yearFromText(undefined)).toBe(null);
    expect(yearFromText("")).toBe(null);
    expect(yearFromText("no year here")).toBe(null);
  });

  test("preserves explicit negatives", () => {
    expect(yearFromText("-425")).toBe(-425);
    expect(yearFromText("c. -425")).toBe(-425);
  });

  test.each([
    ["ca. 3300-2250 BCE", -3300],
    ["3300–2000 BCE", -3300],
    ["c. 2300 BCE", -2300],
    ["2040–1783 BCE", -2040],
    ["mid 4th millennium BCE (Predynastic)", null],
    // 425 BC (no 'E') - the bug class includes this short form
    ["425 BC", -425],
    // BCE inside a longer phrase
    ["Made circa 3000 BCE in Mesopotamia", -3000],
    // B.C.E. punctuated form
    ["c. 1500 B.C.E.", -1500],
    // "before the common era" spelled out
    ["1000 years before the common era", -1000],
  ])("BCE detection: %s → %s", (input, expected) => {
    expect(yearFromText(input)).toBe(expected);
  });

  test("does not falsely negate CE dates that happen to contain 'bc' substring", () => {
    // Word-boundary anchors mean substrings inside other words don't fire.
    expect(yearFromText("Painted in 1865 by Albrecht (abc-bcd)")).toBe(1865);
  });

  test("BCE marker without a 3-4 digit year returns null", () => {
    // "mid 4th millennium BCE" has no 3-4 digit number; the parser must not
    // invent one. Walters has many records of this shape, all left null.
    expect(yearFromText("mid 4th millennium BCE")).toBe(null);
  });

  test("two-year ranges return the first year", () => {
    expect(yearFromText("1907–1909")).toBe(1907);
    expect(yearFromText("1907, 1908, 1909")).toBe(1907);
  });

  test("two-year BCE ranges negate the first year", () => {
    expect(yearFromText("3300–2250 BCE")).toBe(-3300);
    expect(yearFromText("1766–1122 BCE")).toBe(-1766);
  });

  test("coerces numeric inputs (LIDO XML parser passes numbers, not strings)", () => {
    // fast-xml-parser auto-parses purely numeric date elements to JS numbers.
    // The Städel adapter passes those values straight in; without coercion,
    // value.match throws. Lock this regression in.
    expect(yearFromText(1471)).toBe(1471);
    expect(yearFromText(-425)).toBe(-425);
    expect(yearFromText(0)).toBe(null); // string "0" has no 3-4 digit run
  });
});
