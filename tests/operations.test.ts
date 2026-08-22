import { describe, expect, it } from "vitest";

import { cellColumnAt, mergeCell, splitCell } from "../src/core/operations";
import { parseStructuralTables } from "../src/core/parser";

const source = "| Group | < |\n| A | B |\n| --- | --- |\n| 1 |  |";

describe("table operations", () => {
  it("merges an empty cell and validates the candidate", () => {
    const table = parseStructuralTables(source).tables[0]!;
    const result = mergeCell(table, 2, 1, "left");
    expect(result.changed).toBe(true);
    expect(result.source).toContain("| 1 | < |");
    expect(parseStructuralTables(result.source).tables[0]?.valid).toBe(true);
  });

  it("refuses to discard non-empty content or cross an edge", () => {
    const table = parseStructuralTables(source.replace("| 1 |  |", "| 1 | 2 |")).tables[0]!;
    expect(mergeCell(table, 2, 1, "left").changed).toBe(false);
    expect(mergeCell(table, 2, 0, "left").changed).toBe(false);
    expect(mergeCell(table, 0, 0, "up").changed).toBe(false);
  });

  it("splits the whole merge group while retaining anchor content", () => {
    const table = parseStructuralTables("| Group | < |\n| A | B |\n| --- | --- |\n| 1 | 2 |").tables[0]!;
    const result = splitCell(table, 0, 1);
    expect(result.changed).toBe(true);
    expect(result.source).toContain("| Group |  |");
    expect(splitCell(parseStructuralTables(result.source).tables[0]!, 0, 0).changed).toBe(false);
  });

  it("can split the final structural feature into a plain GFM table", () => {
    const table = parseStructuralTables("| A | B |\n| --- | --- |\n| 1 | < |").tables[0]!;
    const result = splitCell(table, 1, 1);
    expect(result.changed).toBe(true);
    expect(parseStructuralTables(result.source).tables).toEqual([]);
    expect(result.source).toContain("| 1 |  |");
  });

  it("maps cursor positions to pipe cells", () => {
    expect(cellColumnAt("| A | B |", 2)).toBe(0);
    expect(cellColumnAt("| A | B |", 7)).toBe(1);
    expect(cellColumnAt(String.raw`| a\|b | c |`, 6)).toBe(0);
  });
});
