import { describe, expect, it } from "vitest";

import { planTransposeTable, transposeTable } from "../src/core/operations";
import type { StructuralTable } from "../src/core/model";
import { parseEditableTables } from "../src/core/parser";

function parse(source: string): StructuralTable {
  const table = parseEditableTables(source).tables[0];
  expect(table?.valid).toBe(true);
  return table!;
}

function visibleContent(table: StructuralTable, row: number, column: number): string {
  const cell = table.rows[row]!.cells[column]!;
  return table.rows[cell.anchorRow]!.cells[cell.anchorColumn]!.content;
}

function expectExactTranspose(before: StructuralTable, after: StructuralTable): void {
  expect(after.rows.length).toBe(before.columnCount);
  expect(after.columnCount).toBe(before.rows.length);
  expect(after.headerRowCount).toBe(before.rowHeaderColumnCount);
  expect(after.rowHeaderColumnCount).toBe(before.headerRowCount);
  for (let row = 0; row < before.rows.length; row += 1) {
    for (let column = 0; column < before.columnCount; column += 1) {
      const original = before.rows[row]!.cells[column]!;
      const updated = after.rows[column]!.cells[row]!;
      const swappedRole = {
        corner_header: "corner_header", column_header: "row_header",
        row_header: "column_header", data: "data",
      } as const;
      expect(updated.role).toBe(swappedRole[original.role]);
      expect(visibleContent(after, column, row)).toBe(visibleContent(before, row, column));
      expect(updated.anchorRow).toBe(original.anchorColumn);
      expect(updated.anchorColumn).toBe(original.anchorRow);
      if (!original.covered) {
        expect(updated.rowSpan).toBe(original.columnSpan);
        expect(updated.columnSpan).toBe(original.rowSpan);
      }
    }
  }
}

describe("whole-table structural transpose", () => {
  it.each([
    ["headerless", "| --- | --- | --- |\\n| A | 1 | 2 |\\n| B | 3 | 4 |", 0, 0],
    ["row headers only", "| --- || --- | --- |\\n| A | 1 | 2 |\\n| B | 3 | 4 |", 0, 1],
    ["column headers only", "| Name | Q1 | Q2 |\\n| --- | --- | --- |\\n| A | 1 | 2 |\\n| B | 3 | 4 |", 1, 0],
    ["both header axes", "| Region | Q1 | Q2 |\\n| --- || --- | --- |\\n| A | 1 | 2 |\\n| B | 3 | 4 |", 1, 1],
    ["multiple header layers", "| Corner | Group | Value | < |\\n| Name | Q1 | Q2 | Q3 |\\n| --- || --- || --- | --- |\\n| A | 1 | 2 | 3 |\\n| B | 4 | 5 | 6 |", 2, 2],
  ] as const)("transposes %s with every logical cell and role", (_name, source, headerRows, rowHeaders) => {
    // A single || is required by the actual grammar, even for multiple row-header columns.
    const corrected = source.replace("| --- || --- || --- | --- |", "| --- | --- || --- | --- |");
    const before = parse(corrected.replace(/\\\\n/gu, "\\n"));
    expect(before.headerRowCount).toBe(headerRows);
    expect(before.rowHeaderColumnCount).toBe(rowHeaders);
    const result = transposeTable(before);
    expect(result.changed).toBe(true);
    const after = parse(result.source);
    expectExactTranspose(before, after);
  });

  it("exchanges horizontal, vertical and two-dimensional merge geometry without treating literal markers as merges", () => {
    const before = parse(
      "| H1 | H2 | < |\\n| --- || --- | --- |\\n| Group | A | B |\\n| ^ | C | D |".replace(/\\\\n/gu, "\\n"),
    );
    const outcome = transposeTable(before);
    expect(outcome.changed).toBe(true);
    expectExactTranspose(before, parse(outcome.source));

    const complex = parse(
      "| --- | --- | --- |\\n| One | < | \\< |\\n| ^ | < | \\^ |".replace(/\\\\n/gu, "\\n"),
    );
    const result = transposeTable(complex);
    expect(result.changed).toBe(true);
    const after = parse(result.source);
    expectExactTranspose(complex, after);
    expect(visibleContent(after, 2, 0)).toBe("<");
    expect(visibleContent(after, 2, 1)).toBe("^");
  });

  it("leaves uniformly aligned columns aligned and flags mixed alignment loss", () => {
    const uniform = parse("| A | B |\\n| :---: | :---: |\\n| x | y |".replace(/\\\\n/gu, "\\n"));
    const preserved = planTransposeTable(uniform);
    expect(preserved.resetsColumnAlignment).toBe(false);
    expect(preserved.introducesStructuralSyntax).toBe(true);
    expect(parse(preserved.result.source).alignments).toEqual(["center", "center"]);
    const mixed = parse("| A | B |\\n| :--- | ---: |\\n| x | y |".replace(/\\\\n/gu, "\\n"));
    const plan = planTransposeTable(mixed);
    expect(plan.resetsColumnAlignment).toBe(true);
    expect(plan.result.changed).toBe(true);
    expect(parse(plan.result.source).alignments).toEqual(["default", "default"]);
  });

  it("rejects header-only tables rather than inserting a fake data column", () => {
    const before = parse("| H1 | H2 |\\n| Name | Value |\\n| --- | --- |".replace(/\\\\n/gu, "\\n"));
    const result = transposeTable(before);
    expect(result).toMatchObject({
      changed: false, code: "transpose-unrepresentable", source: before.source,
    });
  });

  it("treats a 1x1 headerless table as no-op without formatting the source", () => {
    const before = parse("| --- |\\n| one |".replace(/\\\\n/gu, "\\n"));
    expect(transposeTable(before)).toMatchObject({ changed: false, code: "table-transposed", source: before.source });
  });

  it("refuses hidden GFM overflow, malformed structural tables and delimiter-like false positives", () => {
    const overflow = parse("| A | B |\\n| --- | --- |\\n| x | y | hidden |".replace(/\\\\n/gu, "\\n"));
    expect(transposeTable(overflow).changed).toBe(false);
    const invalid = parseEditableTables("| A | B |\\n| --- || --- |\\n| x | < |".replace(/\\\\n/gu, "\\n")).tables[0]!;
    expect(transposeTable(invalid).changed).toBe(false);
  });

  it("keeps ordinary GFM ownership semantics and restores the logical table by transposing twice", () => {
    const ordinary = parse("| Name | Number |\\n| --- | --- |\\n| A | 1 |\\n| B | 2 |".replace(/\\\\n/gu, "\\n"));
    const first = planTransposeTable(ordinary);
    expect(first.introducesStructuralSyntax).toBe(true);
    const second = transposeTable(parse(first.result.source));
    expect(second.changed).toBe(true);
    expectExactTranspose(parse(first.result.source), parse(second.source));
    const restored = parse(second.source);
    expect(restored.headerRowCount).toBe(ordinary.headerRowCount);
    expect(restored.rowHeaderColumnCount).toBe(ordinary.rowHeaderColumnCount);
    expect(restored.structural).toBe(false);
  });

  it("preserves nested blockquote prefix and CRLF line endings", () => {
    const before = parse("> | A | B |\\r\\n> | --- | --- |\\r\\n> | 1 | 2 |".replace(/\\\\r\\\\n/gu, "\\r\\n"));
    const result = transposeTable(before);
    expect(result.changed).toBe(true);
    expect(result.source).toContain("\\r\\n> ");
    expect(result.source.split("\\r\\n").every((line) => line.startsWith("> "))).toBe(true);
    expectExactTranspose(before, parse(result.source));
  });
});
