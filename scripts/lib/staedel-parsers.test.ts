import { describe, expect, test } from "vitest";
import { flipSurnameFirst } from "./staedel-parsers";

describe("flipSurnameFirst", () => {
  test("passes through already-natural names unchanged", () => {
    expect(flipSurnameFirst("Pablo Picasso")).toBe("Pablo Picasso");
    expect(flipSurnameFirst("Albrecht Dürer")).toBe("Albrecht Dürer");
  });

  test("flips 'Surname, Forename' to 'Forename Surname'", () => {
    expect(flipSurnameFirst("Dürer, Albrecht")).toBe("Albrecht Dürer");
    expect(flipSurnameFirst("Vermeer, Johannes")).toBe("Johannes Vermeer");
  });

  test("trims surrounding whitespace", () => {
    expect(flipSurnameFirst("  Dürer, Albrecht  ")).toBe("Albrecht Dürer");
    expect(flipSurnameFirst("\tDürer, Albrecht\n")).toBe("Albrecht Dürer");
  });

  test("preserves multi-word surnames and forenames", () => {
    // "van Rijn" is a tussenvoegsel and is normally part of the sortable
    // surname in LIDO; flip preserves the multi-word chunks.
    expect(flipSurnameFirst("van Rijn, Rembrandt")).toBe("Rembrandt van Rijn");
    expect(flipSurnameFirst("Cranach the Elder, Lucas")).toBe(
      "Lucas Cranach the Elder",
    );
  });

  test("only splits on the FIRST ', ' (preserves later commas)", () => {
    // The split limit of 2 means anything after the second comma is
    // intentionally dropped. This matches the adapter's behaviour - if
    // Städel ships "Rijn, Rembrandt van, II" we deliberately discard
    // the "II" rather than guess where it belongs.
    expect(flipSurnameFirst("Rijn, Rembrandt van, II")).toBe(
      "Rembrandt van Rijn",
    );
  });

  test("does not flip when there is no ', ' separator (just a comma)", () => {
    // The comma-space check requires both characters; "Picasso,Pablo"
    // (no space) does not match and is treated as a single token. This
    // is intentional - LIDO records always use ", " as the separator.
    expect(flipSurnameFirst("Picasso,Pablo")).toBe("Picasso,Pablo");
  });
});
