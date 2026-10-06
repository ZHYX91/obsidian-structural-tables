import { describe, expect, it } from "vitest";

import {
  alignTableColumns,
  appendTableRow,
  clearTableCells,
  editCellAndAppendRow,
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
  reorderTableAxis,
  removeTable,
  removeTableAxis,
  setHeaderRowCount,
  setRowHeaderColumnCount,
  splitCell,
} from "../src/core/operations";
import { parseEditableTables, parseStructuralTables } from "../src/core/parser";
import type { StructuralTable } from "../src/core/model";
import type { OperationResult } from "../src/core/operations";

const source = "| Group | < |\n| A | B |\n| --- | --- |\n| 1 |  |";

describe("table operations", () => {
  const overflowOperations: [string, (table: StructuralTable) => OperationResult][] = [
    ["edit cell", (table) => editCellContent(table, 1, 0, "Updated")],
    ["edit and append", (table) => editCellAndAppendRow(table, 1, 1, "Draft")],
    ["append row", appendTableRow],
    ["insert row", (table) => insertTableRow(table, 1, "after")],
    ["insert column", (table) => insertTableColumn(table, 0, "after")],
    ["delete row", (table) => deleteTableRows(table, 2, 2)],
    ["delete column", (table) => deleteTableColumns(table, 1, 1)],
    ["clear cell", (table) => clearTableCells(table, [{ row: 1, column: 0 }])],
    ["explicit remove row", (table) => removeTableAxis(table, "row", 1, 1)],
    ["explicit remove column", (table) => removeTableAxis(table, "column", 0, 0)],
    ["explicit remove table", removeTable],
    ["reorder rows", (table) => reorderTableAxis(table, "row", 1, 1, 3)],
    ["move rows", (table) => moveTableRows(table, 1, 1, "forward")],
    ["move columns", (table) => moveTableColumns(table, 0, 0, "forward")],
    ["align columns", (table) => alignTableColumns(table, 0, 1, "right")],
    ["merge cell", (table) => mergeCell(table, 1, 1, "left")],
    ["merge selection", (table) => mergeCellRange(table, 1, 0, 1, 1)],
    ["split cell", (table) => splitCell(table, 1, 0)],
    ["set column headers", (table) => setHeaderRowCount(table, 2)],
    ["remove column headers", (table) => setHeaderRowCount(table, 0)],
    ["set row headers", (table) => setRowHeaderColumnCount(table, 1)],
  ];

  it.each(overflowOperations)("refuses %s and preserves all hidden GFM source cells", (_name, operation) => {
    for (const ending of ["\n", "\r\n", "\r"]) {
      const text = ["| A | B |", "| --- | --- |", "| 1 | | KEEP |", "| | |"].join(ending);
      const table = parseEditableTables(text).tables[0]!;
      expect(table.valid).toBe(true);
      expect(operation(table)).toMatchObject({ changed: false, code: "gfm-overflow-readonly", source: text });
      expect(table.source).toBe(text);
    }
  });

  it.each(["<", "^"])("keeps hidden %s overflow source read-only without taking structural ownership", (marker) => {
    const source = `| A | B |\n| --- | --- |\n| 1 | 2 | ${marker} |`;
    const table = parseEditableTables(source).tables[0]!;

    expect(table).toMatchObject({ structural: false, valid: true, columnCount: 2 });
    expect(editCellContent(table, 1, 0, "Updated")).toMatchObject({
      changed: false,
      code: "gfm-overflow-readonly",
      source,
    });
    expect(table.source).toBe(source);
  });

  it("preserves headerless data and short delimiter alignment through header-role changes", () => {
    const table = parseEditableTables("| :-: | --: |\n| Alice | 10 |\n| Bob | 20 |").tables[0]!;
    expect(table).toMatchObject({ valid: true, structural: true, headerRowCount: 0 });
    const withHeader = setHeaderRowCount(table, 1);
    expect(withHeader.changed).toBe(true);
    const removed = setHeaderRowCount(parseEditableTables(withHeader.source).tables[0]!, 0);
    expect(removed.changed).toBe(true);
    const next = parseEditableTables(removed.source).tables[0]!;
    expect(next.headerRowCount).toBe(0);
    expect(next.alignments).toEqual(["center", "right"]);
    expect(next.rows.map((row) => row.cells.map((cell) => cell.content))).toEqual([["Alice", "10"], ["Bob", "20"]]);
  });

  it("reorders complete merged row groups atomically and refuses split destinations", () => {
    const text = "> | H | V |\n> | --- || --- |\n> | A | B |\n> | ^ | C |\n> | Z | D |";
    const table = parseStructuralTables(text).tables[0]!;
    expect(reorderTableAxis(table, "row", 1, 1, 4).changed).toBe(false);
    expect(reorderTableAxis(table, "row", 3, 3, 2).changed).toBe(false);
    expect(reorderTableAxis(table, "row", 1, 2, 0).changed).toBe(false);
    const moved = reorderTableAxis(table, "row", 1, 2, 4);
    expect(moved.changed).toBe(true);
    const next = parseStructuralTables(moved.source).tables[0]!;
    expect(next.rows.map((row) => row.cells[0]!.raw.trim())).toEqual(["H", "Z", "A", "^"]);
    expect(next.rows[2]!.cells[0]!.rowSpan).toBe(2);
    expect(moved.source.split("\n").every((line) => line.startsWith("> |"))).toBe(true);
    expect(table.source).toBe(text);
    expect(reorderTableAxis(table, "row", 1, 2, 2)).toMatchObject({ changed: false, source: text });
  });

  it("moves column alignment with content and protects row headers and horizontal spans", () => {
    const table = parseStructuralTables("| R | A | B | C |\n| --- || :--- | ---: | :---: |\n| Z | 1 | 2 | 3 |").tables[0]!;
    const moved = reorderTableAxis(table, "column", 1, 1, 4);
    const next = parseStructuralTables(moved.source).tables[0]!;
    expect(next.rows[1]!.cells.map((cell) => cell.content)).toEqual(["Z", "2", "3", "1"]);
    expect(next.alignments).toEqual(["default", "right", "center", "left"]);
    expect(reorderTableAxis(table, "column", 0, 0, 4).changed).toBe(false);
    expect(reorderTableAxis(table, "column", 1, 1, NaN).changed).toBe(false);
    const merged = parseStructuralTables("| R | A | < | C |\n| --- || --- | --- | --- |\n| Z | 1 | 2 | 3 |").tables[0]!;
    expect(reorderTableAxis(merged, "column", 1, 1, 4).changed).toBe(false);
    expect(reorderTableAxis(merged, "column", 3, 3, 2).changed).toBe(false);
    expect(reorderTableAxis(merged, "column", 1, 2, 4).changed).toBe(true);
  });
  it("removes and restores column-header roles without deleting content", () => {
    const table = parseEditableTables("| Name | Age |\n| --- | --- |\n| Alice | 20 |").tables[0]!;
    const removed = setHeaderRowCount(table, 0);
    expect(removed).toMatchObject({ changed: true, code: "header-rows-set" });
    expect(removed.source.split("\n")[0]).toContain("---");
    const headerless = parseStructuralTables(removed.source).tables[0]!;
    expect(headerless.headerRowCount).toBe(0);
    expect(headerless.rows.map((row) => row.cells.map((cell) => cell.content)))
      .toEqual([["Name", "Age"], ["Alice", "20"]]);

    const restored = setHeaderRowCount(headerless, 1);
    const headerful = parseEditableTables(restored.source).tables[0]!;
    expect(restored.changed).toBe(true);
    expect(headerful.headerRowCount).toBe(1);
    expect(headerful.rows[0]?.cells.map((cell) => cell.content)).toEqual(["Name", "Age"]);
  });

  it("refuses a header-role boundary that would cut through a merged cell", () => {
    const table = parseStructuralTables(
      "| Group | Value |\n| ^ | Detail |\n| --- | --- |\n| A | 1 |",
    ).tables[0]!;
    expect(table).toMatchObject({ valid: true, headerRowCount: 2 });
    const changed = setHeaderRowCount(table, 1);
    expect(changed.changed).toBe(false);
    expect(changed.code).toBe("invalid-result");
    expect(changed.source).toBe(table.source);
  });

  it("keeps zero header rows when an empty former header row is deleted", () => {
    const headerless = parseStructuralTables("| --- | --- |\n|  |  |\n| Alice | 20 |").tables[0]!;
    const withHeader = setHeaderRowCount(headerless, 1);
    const table = parseEditableTables(withHeader.source).tables[0]!;
    const deleted = deleteTableRows(table, 0, 0);
    expect(deleted.changed).toBe(true);
    expect(parseStructuralTables(deleted.source).tables[0]?.headerRowCount).toBe(0);
    expect(parseStructuralTables(deleted.source).tables[0]?.rows[0]?.cells[0]?.content).toBe("Alice");
  });

  it("appends a data row to header-only tables without changing header roles", () => {
    const table = parseStructuralTables("| Group | < |\r\n| Name | Value |\r\n| --- | --- |").tables[0]!;
    const result = appendTableRow(table);
    const next = parseStructuralTables(result.source).tables[0]!;
    expect(next.headerRowCount).toBe(2);
    expect(next.rows).toHaveLength(3);
    expect(next.rows[2]!.cells.every((cell) => !cell.covered && cell.content === "")).toBe(true);
    expect(result.source).toContain("\r\n");
  });

  it("commits terminal-cell content and appends atomically with deep-list prefixes", () => {
    const table = parseStructuralTables("| H | V |\r| --- || --- |\r| A | B |").tables[0]!;
    const nested = { ...table, sourcePrefix: "    ", source: table.source.split("\r").map((line) => `    ${line}`).join("\r") };
    const result = editCellAndAppendRow(nested, 1, 1, "Saved | value");
    expect(result.changed).toBe(true);
    expect(result.source.split("\r").every((line) => line.startsWith("    |"))).toBe(true);
    const next = parseStructuralTables(result.source.replace(/^ {4}/gm, "")).tables[0]!;
    expect(next.rows).toHaveLength(3);
    expect(next.rows[1]!.cells[1]!.raw).toContain("Saved \\| value");
    expect(next.rowHeaderColumnCount).toBe(1);
    const invalid = editCellAndAppendRow(nested, 99, 0, "New content");
    expect(invalid.changed).toBe(false);
    expect(invalid.source).toBe(nested.source);
  });
  it("normalizes short GFM rows on explicit edits and blocks writes with hidden overflow cells", () => {
    const shortSource = "| A | B |\n| --- | --- |\n| 1 |";
    const shortTable = parseEditableTables(shortSource).tables[0]!;
    const edited = editCellContent(shortTable, 1, 0, "Updated");
    expect(edited.changed).toBe(true);
    const normalized = parseEditableTables(edited.source).tables[0]!;
    expect(normalized.rows[1]?.cells.map((cell) => cell.content)).toEqual(["Updated", ""]);
    expect(normalized.rows[1]?.sourceCellCount).toBe(2);

    const overflowSource = "| A | B |\n| --- | --- |\n| 1 | 2 | keep-me |";
    const overflow = parseEditableTables(overflowSource).tables[0]!;
    expect(overflow.valid).toBe(true);
    expect(editCellContent(overflow, 1, 0, "Updated")).toMatchObject({
      changed: false,
      code: "gfm-overflow-readonly",
      source: overflowSource,
    });
    expect(appendTableRow(overflow)).toMatchObject({
      changed: false,
      code: "gfm-overflow-readonly",
      source: overflowSource,
    });
  });

  it("merges an empty cell and validates the candidate", () => {
    const table = parseStructuralTables(source).tables[0]!;
    const result = mergeCell(table, 2, 1, "left");
    expect(result.changed).toBe(true);
    const reparsed = parseStructuralTables(result.source).tables[0];
    expect(reparsed?.rows[2]?.cells[1]?.marker).toBe("left");
    expect(reparsed?.valid).toBe(true);
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
    expect(parseStructuralTables(result.source).tables[0]?.rows[0]?.cells[1]?.content).toBe("");
    expect(splitCell(parseStructuralTables(result.source).tables[0]!, 0, 0).changed).toBe(false);
  });

  it("can split the final structural feature into a plain GFM table", () => {
    const table = parseStructuralTables("| A | B |\n| --- | --- |\n| 1 | < |").tables[0]!;
    const result = splitCell(table, 1, 1);
    expect(result.changed).toBe(true);
    expect(parseStructuralTables(result.source).tables).toEqual([]);
    expect(parseEditableTables(result.source).tables[0]?.rows[1]?.cells[1]?.content).toBe("");
  });

  it("maps cursor positions to pipe cells", () => {
    expect(cellColumnAt("| A | B |", 2)).toBe(0);
    expect(cellColumnAt("| A | B |", 7)).toBe(1);
    expect(cellColumnAt(String.raw`| a\|b | c |`, 6)).toBe(0);
    expect(cellColumnAt("| A | ``x|y`` |  |", 11)).toBe(1);
    const unmatched = "| `oops | < | x |   |";
    expect(cellColumnAt(unmatched, unmatched.indexOf("x") + 1)).toBe(2);
  });

  it("merges a rectangular selection without discarding its top-left content", () => {
    const table = parseStructuralTables("| Group | Value |\n| Name | Amount |\n| --- | --- |\n| A |  |\n|  |  |").tables[0]!;
    const result = mergeCellRange(table, 2, 0, 3, 1);
    expect(result).toMatchObject({ changed: true, code: "merged" });
    const reparsed = parseStructuralTables(result.source).tables[0];
    expect(reparsed?.rows[2]?.cells[1]?.marker).toBe("left");
    expect(reparsed?.rows[3]?.cells.map((cell) => cell.marker)).toEqual(["up", "up"]);
    expect(reparsed).toMatchObject({ valid: true });
  });

  it("bootstraps structural syntax by merging an ordinary GFM table selection", () => {
    const table = parseEditableTables("| A | B |\n| --- | --- |\n| 1 |  |").tables[0]!;
    const result = mergeCellRange(table, 1, 0, 1, 1);
    expect(result).toMatchObject({ changed: true, code: "merged" });
    expect(parseStructuralTables(result.source).tables[0]?.rows[1]?.cells[1]?.marker).toBe("left");
  });

  it("bootstraps multi-row and row headers from an ordinary GFM table", () => {
    const table = parseEditableTables("| A | B |\n| --- | --- |\n| C | D |").tables[0]!;
    expect(setHeaderRowCount(table, 2).source.split("\n")[2]?.replace(/ /gu, "")).toBe("|---|---|");
    expect(setRowHeaderColumnCount(table, 1).source).toContain("||");
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
    expect(reduced.source.split("\n")[1]?.replace(/ /gu, "")).toBe("|---|---|");

    const expandedTable = parseStructuralTables(reduced.source).tables[0];
    expect(expandedTable).toBeUndefined();
    expect(setHeaderRowCount(table, 3).source.split("\n")[3]?.replace(/ /gu, "")).toBe("|---|---|");
  });

  it("moves and removes the row-header divider", () => {
    const table = parseStructuralTables("| Group | Value |\n| Name | Amount |\n| --- | --- |\n| A | 1 |").tables[0]!;
    const added = setRowHeaderColumnCount(table, 1);
    expect(added).toMatchObject({ changed: true, code: "row-headers-set" });
    expect(added.source).toContain("||");
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

  it("clears selected owner content without changing roles, alignment, or merge topology", () => {
    const text = [
      "| Group | Amount | < |",
      "| --- || :---: | ---: |",
      "| North | 10 | 20 |",
      "| South | 30 | 40 |",
    ].join("\n");
    const table = parseStructuralTables(text).tables[0]!;

    const mergedHeader = clearTableCells(table, [
      { row: 0, column: 1 },
      { row: 0, column: 2 },
    ]);
    expect(mergedHeader).toMatchObject({ changed: true, code: "cells-cleared" });
    const merged = parseStructuralTables(mergedHeader.source).tables[0]!;
    expect(merged.headerRowCount).toBe(1);
    expect(merged.rowHeaderColumnCount).toBe(1);
    expect(merged.alignments).toEqual(["default", "center", "right"]);
    expect(merged.rows[0]!.cells[0]!.content).toBe("Group");
    expect(merged.rows[0]!.cells[1]).toMatchObject({ content: "", columnSpan: 2, covered: false });
    expect(merged.rows[0]!.cells[2]).toMatchObject({ marker: "left", covered: true });

    const partial = clearTableCells(table, [
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ]);
    expect(parseStructuralTables(partial.source).tables[0]!.rows[1]!.cells.map((cell) => cell.content))
      .toEqual(["North", "", ""]);

    const fullRow = clearTableCells(table, [
      { row: 2, column: 0 }, { row: 2, column: 1 }, { row: 2, column: 2 },
    ]);
    expect(parseStructuralTables(fullRow.source).tables[0]!.rows[2]!.cells.every((cell) => cell.content === "")).toBe(true);

    const fullColumn = clearTableCells(table, [
      { row: 1, column: 2 }, { row: 2, column: 2 },
    ]);
    const column = parseStructuralTables(fullColumn.source).tables[0]!;
    expect(column.rows[0]!.cells[1]!.content).toBe("Amount");
    expect(column.rows[1]!.cells[2]!.content).toBe("");
    expect(column.rows[2]!.cells[2]!.content).toBe("");

    const allCoordinates = table.rows.flatMap((row) => row.cells.map((cell) => ({ row: cell.row, column: cell.column })));
    const all = clearTableCells(table, allCoordinates);
    const emptied = parseStructuralTables(all.source).tables[0]!;
    expect(emptied.rows.every((row) => row.cells.filter((cell) => !cell.covered).every((cell) => cell.content === ""))).toBe(true);
    expect(emptied.rows[0]!.cells[2]!.marker).toBe("left");
    expect(emptied.headerRowCount).toBe(1);
    expect(emptied.rowHeaderColumnCount).toBe(1);
  });

  it("refuses duplicate or partial merged-owner clear coordinates and treats empty owners as a byte-stable noop", () => {
    const merged = parseStructuralTables("| A | < |\n| --- | --- |\n|  |  |").tables[0]!;
    expect(clearTableCells(merged, [{ row: 0, column: 0 }])).toMatchObject({
      changed: false,
      code: "invalid-result",
      source: merged.source,
    });
    expect(clearTableCells(merged, [
      { row: 0, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 1 },
    ])).toMatchObject({
      changed: false,
      code: "invalid-result",
      source: merged.source,
    });

    const empty = parseEditableTables("| A | B |\n| --- | --- |\n|  |  |").tables[0]!;
    const result = clearTableCells(empty, [{ row: 1, column: 0 }, { row: 1, column: 1 }]);
    expect(result).toEqual({
      changed: false,
      code: "cells-cleared",
      message: "The selected cells are already empty.",
      source: empty.source,
    });
  });

  it("allows ragged visible GFM clear but keeps hidden overflow blocked", () => {
    const ragged = parseEditableTables("| A | B |\n| --- | --- |\n| 1 |").tables[0]!;
    const cleared = clearTableCells(ragged, [{ row: 1, column: 0 }]);
    expect(cleared).toMatchObject({ changed: true, code: "cells-cleared" });
    expect(parseEditableTables(cleared.source).tables[0]!.rows[1]!.cells.map((cell) => cell.content))
      .toEqual(["", ""]);

    const overflowSource = "| A | B |\n| --- | --- |\n| 1 | 2 | KEEP |";
    const overflow = parseEditableTables(overflowSource).tables[0]!;
    for (const operation of [
      () => clearTableCells(overflow, [{ row: 1, column: 0 }]),
      () => removeTableAxis(overflow, "row", 1, 1),
      () => removeTableAxis(overflow, "column", 0, 0),
      () => removeTable(overflow),
    ]) {
      expect(operation()).toMatchObject({
        changed: false,
        code: "gfm-overflow-readonly",
        source: overflowSource,
      });
    }
  });

  it("keeps guarded delete APIs lossy-safe while explicit removal may discard selected visible content", () => {
    const table = parseStructuralTables("| H | V |\n| --- || --- |\n| A | 1 |\n| B | 2 |").tables[0]!;
    expect(deleteTableRows(table, 2, 2)).toMatchObject({ changed: false, code: "content-would-be-lost" });
    expect(deleteTableColumns(table, 1, 1)).toMatchObject({ changed: false, code: "content-would-be-lost" });

    const row = removeTableAxis(table, "row", 2, 2);
    expect(row).toMatchObject({ changed: true, code: "rows-deleted" });
    expect(parseStructuralTables(row.source).tables[0]!.rows.map((item) => item.cells.map((cell) => cell.content)))
      .toEqual([["H", "V"], ["A", "1"]]);

    const column = removeTableAxis(table, "column", 1, 1);
    expect(column).toMatchObject({ changed: true, code: "columns-deleted" });
    expect(parseEditableTables(column.source).tables[0]!.rows.map((item) => item.cells[0]!.content))
      .toEqual(["H", "A", "B"]);

    expect(removeTable(table)).toEqual({
      changed: true,
      code: "table-deleted",
      message: "Table deleted.",
      source: "",
    });
    expect(removeTableAxis(table, "row", 0, table.rows.length - 1).code).toBe("table-deleted");
    expect(removeTableAxis(table, "column", 0, table.columnCount - 1).code).toBe("table-deleted");
  });

  it("preserves surviving merged-owner content when explicit axis removal trims its span", () => {
    const vertical = parseStructuralTables("| H | V |\n| --- | --- |\n| A | 1 |\n| ^ | 2 |\n| B | 3 |").tables[0]!;
    const rows = removeTableAxis(vertical, "row", 2, 2);
    const rowTable = parseEditableTables(rows.source).tables[0]!;
    expect(rows.changed).toBe(true);
    expect(rowTable.rows[1]!.cells[0]!.content).toBe("A");
    expect(rowTable.rows[1]!.cells[0]!.rowSpan).toBe(1);

    const horizontal = parseStructuralTables("| H | V | W |\n| --- | --- | --- |\n| A | < | 3 |\n| B | 2 | 4 |").tables[0]!;
    const columns = removeTableAxis(horizontal, "column", 1, 1);
    const columnTable = parseEditableTables(columns.source).tables[0]!;
    expect(columns.changed).toBe(true);
    expect(columnTable.rows[1]!.cells[0]!.content).toBe("A");
    expect(columnTable.rows[1]!.cells[0]!.columnSpan).toBe(1);
  });

  it("remaps header roles narrowly for explicit row removal", () => {
    const ordinary = parseEditableTables("| H1 | H2 |\n| --- | --- |\n| A | 1 |\n| B | 2 |").tables[0]!;
    expect(ordinary.structural).toBe(false);
    const removedHeader = removeTableAxis(ordinary, "row", 0, 0);
    const promoted = parseEditableTables(removedHeader.source).tables[0]!;
    expect(promoted).toMatchObject({ structural: false, headerRowCount: 1 });
    expect(promoted.rows[0]!.cells.map((cell) => cell.content)).toEqual(["A", "1"]);

    const headerless = parseStructuralTables("| --- | --- |\n| A | 1 |\n| B | 2 |").tables[0]!;
    const headerlessRemoved = removeTableAxis(headerless, "row", 1, 1);
    expect(parseStructuralTables(headerlessRemoved.source).tables[0]!.headerRowCount).toBe(0);

    const multi = parseStructuralTables("| Top | < |\n| H1 | H2 |\n| --- | --- |\n| A | 1 |").tables[0]!;
    const oneHeader = removeTableAxis(multi, "row", 0, 0);
    const next = parseEditableTables(oneHeader.source).tables[0]!;
    expect(next.headerRowCount).toBe(1);
    expect(next.rows[0]!.cells.map((cell) => cell.content)).toEqual(["H1", "H2"]);
  });

  it("changes only the parsed table range inside a list continuation", () => {
    const ending = "\r\n";
    const note = [
      "Before",
      "- Item",
      "  | H | V |",
      "  | --- || --- |",
      "  | A | 1 |",
      "  continuation",
      "After",
    ].join(ending);
    const table = parseEditableTables(note).tables[0]!;
    const before = note.slice(0, table.range.from);
    const after = note.slice(table.range.to);

    const cleared = clearTableCells(table, [{ row: 1, column: 1 }]);
    expect(cleared.changed).toBe(true);
    expect(cleared.source.split(ending).every((line) => line.startsWith("  |"))).toBe(true);
    const clearedNote = before + cleared.source + after;
    expect(clearedNote.slice(0, before.length)).toBe(before);
    expect(clearedNote.slice(-after.length)).toBe(after);
    expect(cleared.source.split(ending).every((line) => line.startsWith("  |"))).toBe(true);
    const parsedCleared = parseEditableTables(clearedNote).tables[0]!;
    expect(parsedCleared.rows[1]!.cells[1]!.content).toBe("");
    expect(parsedCleared.sourcePrefix).toBe("  ");

    const removed = removeTable(table);
    expect(removed).toMatchObject({ changed: true, code: "table-deleted", source: "" });
    expect(before + removed.source + after).toBe([
      "Before",
      "- Item",
      "",
      "  continuation",
      "After",
    ].join(ending));
    expect(before + removed.source + after).toBe(before + after);
  });

  it.each(["\n", "\r\n", "\r"])("preserves quote prefix and %j endings through clear and explicit removal", (ending) => {
    const source = ["> | H | V |", "> | --- || :---: |", "> | A | 1 |", "> | B | 2 |"].join(ending);
    const table = parseStructuralTables(source).tables[0]!;
    const cleared = clearTableCells(table, [{ row: 1, column: 1 }]);
    expect(cleared.changed).toBe(true);
    expect(cleared.source.split(/\r\n|\r|\n/u).every((line) => line.startsWith("> |"))).toBe(true);
    expect(cleared.source.includes(ending)).toBe(true);
    expect(parseStructuralTables(cleared.source).tables[0]!.alignments).toEqual(["default", "center"]);

    const removed = removeTableAxis(table, "row", 2, 2);
    expect(removed.changed).toBe(true);
    expect(removed.source.split(/\r\n|\r|\n/u).every((line) => line.startsWith("> |"))).toBe(true);
    expect(removed.source.includes(ending)).toBe(true);
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
    expect(moveTableColumns(table, 0, 0, "forward")).toMatchObject({ changed: false, code: "move-crosses-header" });

    const multiHeader = parseStructuralTables("| A | B | C |\n| D | E | F |\n| --- | --- | --- |\n| 1 | 2 | 3 |").tables[0]!;
    const columns = moveTableColumns(multiHeader, 2, 2, "backward");
    expect(columns).toMatchObject({ changed: true, code: "column-moved" });
    expect(parseStructuralTables(columns.source).tables[0]?.rows[0]?.cells[1]?.content).toBe("C");

    const merged = parseStructuralTables("| H | V |\n| --- | --- |\n| A | 1 |\n| ^ | 2 |\n| B | 3 |").tables[0]!;
    expect(moveTableRows(merged, 2, 2, "forward")).toMatchObject({ changed: false, code: "move-partial-merge" });
  });

  it("updates column alignment without changing cell content", () => {
    const table = parseStructuralTables("| H | V |\n| --- || --- |\n| A | 1 |").tables[0]!;
    const result = alignTableColumns(table, 1, 1, "center");
    expect(result).toMatchObject({ changed: true, code: "column-aligned" });
    expect(result.source).toContain("|| :---: |");
    expect(parseStructuralTables(result.source).tables[0]?.rows[1]?.cells[1]?.content).toBe("1");
  });
});
