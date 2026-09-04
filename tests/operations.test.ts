import { describe, expect, it } from "vitest";

import {
  alignTableColumns,
  cellColumnAt,
  deleteTableColumns,
  deleteTableRows,
  editCellContent,
  insertTableColumn,
  insertTableRow,
  mergeCell,
  mergeCellRange,
  moveTableColumns,
  moveTableRows,
  normalizeTableCellInput,
  setHeaderRowCount,
  setRowHeaderColumnCount,
  splitCell,
} from "../src/core/operations";
import { parseEditableTables, parseStructuralTables } from "../src/core/parser";

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
    expect(cellColumnAt("| A | ``x|y`` |  |", 11)).toBe(1);
  });

  it("merges a rectangular selection without discarding its top-left content", () => {
    const table = parseStructuralTables("| Group | Value |\n| Name | Amount |\n| --- | --- |\n| A |  |\n|  |  |").tables[0]!;
    const result = mergeCellRange(table, 2, 0, 3, 1);
    expect(result).toMatchObject({ changed: true, code: "merged" });
    expect(result.source).toContain("| A | < |");
    expect(result.source).toContain("| ^ | ^ |");
    expect(parseStructuralTables(result.source).tables[0]).toMatchObject({ valid: true });
  });

  it("bootstraps structural syntax by merging an ordinary GFM table selection", () => {
    const table = parseEditableTables("| A | B |\n| --- | --- |\n| 1 |  |").tables[0]!;
    const result = mergeCellRange(table, 1, 0, 1, 1);
    expect(result).toMatchObject({ changed: true, code: "merged" });
    expect(result.source).toContain("| 1 | < |");
  });

  it("bootstraps multi-row and row headers from an ordinary GFM table", () => {
    const table = parseEditableTables("| A | B |\n| --- | --- |\n| C | D |").tables[0]!;
    expect(setHeaderRowCount(table, 2).source.split("\n")[2]).toBe("| --- | --- |");
    expect(setRowHeaderColumnCount(table, 1).source).toContain("| --- || --- |");
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

  it("escapes pasted Wiki-link separators without double escaping or changing code spans", () => {
    expect(normalizeTableCellInput("[[Target|Alias]]")).toBe(String.raw`[[Target\|Alias]]`);
    expect(normalizeTableCellInput(String.raw`[[Target\|Alias]]`)).toBe(String.raw`[[Target\|Alias]]`);
    expect(normalizeTableCellInput("![[Image.png|300]]")).toBe(String.raw`![[Image.png\|300]]`);
    expect(normalizeTableCellInput("`a|b` | c")).toBe("`a|b` \\| c");
    expect(normalizeTableCellInput("^")).toBe(String.raw`\^`);
    expect(normalizeTableCellInput("First\r\nSecond\rThird\nFourth"))
      .toBe("First<br>Second<br>Third<br>Fourth");
  });

  it("edits a merged anchor from any covered coordinate and keeps Wiki links in one cell", () => {
    const table = parseStructuralTables("| A | < |\n| --- | --- |\n| 1 | 2 |").tables[0]!;
    const result = editCellContent(table, 0, 1, "[[Target|Alias]]");
    expect(result).toMatchObject({ changed: true, code: "cell-edited" });
    expect(result.source).toContain(String.raw`[[Target\|Alias]]`);
    const reparsed = parseStructuralTables(result.source).tables[0]!;
    expect(reparsed.columnCount).toBe(2);
    expect(reparsed.rows[0]?.cells[0]?.content).toBe(String.raw`[[Target\|Alias]]`);
    expect(reparsed.rows[0]?.cells[0]?.columnSpan).toBe(2);
  });

  it("inserts inside merged regions by expanding them and inserts blank cells elsewhere", () => {
    const vertical = parseStructuralTables("| H | V |\n| --- | --- |\n| A | 1 |\n| ^ | 2 |").tables[0]!;
    const rowResult = insertTableRow(vertical, 1, "after");
    const rowTable = parseStructuralTables(rowResult.source).tables[0]!;
    expect(rowResult).toMatchObject({ changed: true, code: "row-inserted" });
    expect(rowTable.rows[1]?.cells[0]?.rowSpan).toBe(3);
    expect(rowTable.rows[2]?.cells[1]?.content).toBe("");

    const horizontal = parseStructuralTables("| A | < | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |").tables[0]!;
    const columnResult = insertTableColumn(horizontal, 0, "after");
    const columnTable = parseStructuralTables(columnResult.source).tables[0]!;
    expect(columnResult).toMatchObject({ changed: true, code: "column-inserted" });
    expect(columnTable.rows[0]?.cells[0]?.columnSpan).toBe(3);
    expect(columnTable.columnCount).toBe(4);
  });

  it("deletes only when content is preserved, including moving a merged anchor", () => {
    const merged = parseStructuralTables("| H | V |\n| --- | --- |\n| A |  |\n| ^ |  |").tables[0]!;
    const movedAnchor = deleteTableRows(merged, 1, 1);
    expect(movedAnchor).toMatchObject({ changed: true, code: "rows-deleted" });
    expect(parseEditableTables(movedAnchor.source).tables[0]?.rows[1]?.cells[0]?.content).toBe("A");

    const nonEmpty = parseStructuralTables("| H | V |\n| --- || --- |\n| A | 1 |\n| B | 2 |").tables[0]!;
    expect(deleteTableRows(nonEmpty, 2, 2)).toMatchObject({ changed: false, code: "content-would-be-lost" });
    expect(deleteTableColumns(nonEmpty, 1, 1)).toMatchObject({ changed: false, code: "content-would-be-lost" });

    const emptyColumn = parseStructuralTables("| H |  |\n| --- || --- |\n| A |  |").tables[0]!;
    expect(deleteTableColumns(emptyColumn, 1, 1)).toMatchObject({ changed: true, code: "columns-deleted" });
  });

  it("moves rows and columns within their header regions and refuses to split merges", () => {
    const table = parseStructuralTables("| H | V |\n| --- || --- |\n| A | 1 |\n| B | 2 |").tables[0]!;
    const rows = moveTableRows(table, 2, 2, "backward");
    expect(rows).toMatchObject({ changed: true, code: "row-moved" });
    expect(parseStructuralTables(rows.source).tables[0]?.rows[1]?.cells[0]?.content).toBe("B");
    expect(moveTableColumns(table, 0, 0, "forward")).toMatchObject({ changed: false, code: "invalid-result" });

    const multiHeader = parseStructuralTables("| A | B | C |\n| D | E | F |\n| --- | --- | --- |\n| 1 | 2 | 3 |").tables[0]!;
    const columns = moveTableColumns(multiHeader, 2, 2, "backward");
    expect(columns).toMatchObject({ changed: true, code: "column-moved" });
    expect(parseStructuralTables(columns.source).tables[0]?.rows[0]?.cells[1]?.content).toBe("C");

    const merged = parseStructuralTables("| H | V |\n| --- | --- |\n| A | 1 |\n| ^ | 2 |\n| B | 3 |").tables[0]!;
    expect(moveTableRows(merged, 2, 2, "forward")).toMatchObject({ changed: false, code: "invalid-result" });
  });

  it("updates column alignment without changing cell content", () => {
    const table = parseStructuralTables("| H | V |\n| --- || --- |\n| A | 1 |").tables[0]!;
    const result = alignTableColumns(table, 1, 1, "center");
    expect(result).toMatchObject({ changed: true, code: "column-aligned" });
    expect(result.source).toContain("|| :---: |");
    expect(parseStructuralTables(result.source).tables[0]?.rows[1]?.cells[1]?.content).toBe("1");
  });
});
