import { describe, expect, it } from "vitest";

import {
  cellColumnAt,
  mergeCell,
  mergeCellRange,
  setHeaderRowCount,
  setRowHeaderColumnCount,
  splitCell,
} from "../src/core/operations";
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

  it("merges a rectangular selection without discarding its top-left content", () => {
    const table = parseStructuralTables("| Group | Value |\n| Name | Amount |\n| --- | --- |\n| A |  |\n|  |  |").tables[0]!;
    const result = mergeCellRange(table, 2, 0, 3, 1);
    expect(result).toMatchObject({ changed: true, code: "merged" });
    expect(result.source).toContain("| A | < |");
    expect(result.source).toContain("| ^ | ^ |");
    expect(parseStructuralTables(result.source).tables[0]).toMatchObject({ valid: true });
  });

  it("refuses rectangular merges that lose content, cross roles, or clip an existing merge", () => {
    const content = parseStructuralTables("| Group | Value |\n| Name | Amount |\n| --- | --- |\n| A | B |\n|  |  |").tables[0]!;
    expect(mergeCellRange(content, 2, 0, 3, 1)).toMatchObject({ changed: false, code: "content-would-be-lost" });
    expect(mergeCellRange(content, 1, 0, 2, 0)).toMatchObject({ changed: false, code: "merge-crosses-role" });

    const merged = parseStructuralTables("| Group | Value |\n| Name | Amount |\n| --- | --- |\n| A | < |\n| ^ | ^ |").tables[0]!;
    expect(mergeCellRange(merged, 2, 0, 2, 1)).toMatchObject({ changed: false, code: "merge-partial-existing" });
  });

  it("moves the delimiter to set leading header rows and preserves a valid structure", () => {
    const table = parseStructuralTables("| Group | Value |\n| Name | Amount |\n| --- | --- |\n| A | 1 |").tables[0]!;
    const reduced = setHeaderRowCount(table, 1);
    expect(reduced).toMatchObject({ changed: true, code: "header-rows-set" });
    expect(reduced.source.split("\n")[1]).toBe("| --- | --- |");

    const expandedTable = parseStructuralTables(reduced.source).tables[0];
    expect(expandedTable).toBeUndefined();
    expect(setHeaderRowCount(table, 3).source.split("\n")[3]).toBe("| --- | --- |");
  });

  it("moves and removes the row-header divider", () => {
    const table = parseStructuralTables("| Group | Value |\n| Name | Amount |\n| --- | --- |\n| A | 1 |").tables[0]!;
    const added = setRowHeaderColumnCount(table, 1);
    expect(added).toMatchObject({ changed: true, code: "row-headers-set" });
    expect(added.source).toContain("| --- || --- |");
    const reparsed = parseStructuralTables(added.source).tables[0]!;
    const removed = setRowHeaderColumnCount(reparsed, 0);
    expect(removed.changed).toBe(true);
    expect(removed.source).not.toContain("||");
  });

  it("refuses header boundaries that would split an existing merge", () => {
    const vertical = parseStructuralTables("| Group | Value |\n| Name | Amount |\n| --- | --- |\n| A | 1 |\n| ^ | 2 |").tables[0]!;
    expect(setHeaderRowCount(vertical, 3)).toMatchObject({ changed: false, code: "invalid-result" });

    const horizontal = parseStructuralTables("| Group | Value |\n| Name | Amount |\n| --- | --- |\n| A | < |").tables[0]!;
    expect(setRowHeaderColumnCount(horizontal, 1)).toMatchObject({ changed: false, code: "invalid-result" });
  });
});
