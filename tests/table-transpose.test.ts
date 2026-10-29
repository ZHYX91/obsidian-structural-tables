import { describe, expect, it, vi } from "vitest";

import { planTransposeTable, transposeTable } from "../src/core/operations";
import type { StructuralTable } from "../src/core/model";
import { parseEditableTables } from "../src/core/parser";
import * as tableParser from "../src/core/parser";
import { transposeTableInDocument } from "../src/core/table-transpose-validation";

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
  it("parses the original note once while validating the complete transposed result", () => {
    const source = "Before.\n\n| H1 | H2 |\n| --- | --- |\n| A | B |\n| C | D |\n\nAfter.\n\n| Keep | This |\n| --- | --- |\n| x | y |";
    const table = parse(source);
    const parser = vi.spyOn(tableParser, "parseEditableTables");
    try {
      const result = transposeTableInDocument(source, table);
      expect(result.changed).toBe(true);
      const updated = source.slice(0, table.range.from) + result.source + source.slice(table.range.to);
      const parsedSources = parser.mock.calls.map(([text]) => text);
      expect(parsedSources.filter((text) => text === source)).toHaveLength(1);
      expect(parsedSources.filter((text) => text === updated)).toHaveLength(1);
      expect(parsedSources).toHaveLength(3);
      expect(updated.startsWith("Before.\n\n")).toBe(true);
      expect(updated.slice(updated.indexOf("\n\nAfter."))).toBe(source.slice(source.indexOf("\n\nAfter.")));
    } finally { parser.mockRestore(); }
  });

  it("refuses stale source before parsing the complete note", () => {
    const source = "| H1 | H2 |\n| --- | --- |\n| A | B |\n| C | D |";
    const table = parse(source);
    const parser = vi.spyOn(tableParser, "parseEditableTables");
    try {
      expect(transposeTableInDocument(source.replace("| A | B |", "| changed | B |"), table))
        .toMatchObject({ changed: false, code: "transpose-boundary-unsafe", source: table.source });
      expect(parser).toHaveBeenCalledTimes(1);
      expect(parser.mock.calls[0]![0]).not.toContain("changed");
    } finally { parser.mockRestore(); }
  });

  it.each([
    ["plain", "", ""], ["blockquote", "> ", ""], ["callout", "> ", "> [!note]\n"], ["list", "    ", "- Item\n\n"],
  ])("refuses a %s transpose that would absorb an adjacent pipe line in the full note", (_name, prefix, context) => {
    const source = context + ["| P | Q | R |", "| H1 | H2 |", "| --- | --- |", "| A | B |", "| C | D |"].map((line) => prefix + line).join("\n");
    const table = parse(source);
    expect(table.rows.length).toBe(3); expect(table.columnCount).toBe(2);
    const result = transposeTableInDocument(source, table);
    expect(result.changed).toBe(false);
    expect(result.code).toBe("transpose-boundary-unsafe");
    expect(result.source).toBe(table.source);
  });

  it("allows a separated transpose without changing preceding or following tables and prose", () => {
    const source = "| P | Q | R |\n\n| H1 | H2 |\n| --- | --- |\n| A | B |\n| C | D |\n\nAfter.\n\n| Keep | This |\n| --- | --- |\n| x | y |";
    const table = parse(source); const result = transposeTableInDocument(source, table);
    expect(result.changed).toBe(true);
    const updated = source.slice(0, table.range.from) + result.source + source.slice(table.range.to);
    expectExactTranspose(table, parse(updated));
    expect(updated.slice(updated.indexOf("\n\nAfter."))).toBe(source.slice(source.indexOf("\n\nAfter.")));
  });
  it.each([
    ["headerless", "| --- | --- | --- |\n| A | 1 | 2 |\n| B | 3 | 4 |", 0, 0],
    ["row headers only", "| --- || --- | --- |\n| A | 1 | 2 |\n| B | 3 | 4 |", 0, 1],
    ["column headers only", "| Name | Q1 | Q2 |\n| --- | --- | --- |\n| A | 1 | 2 |\n| B | 3 | 4 |", 1, 0],
    ["both header axes", "| Region | Q1 | Q2 |\n| --- || --- | --- |\n| A | 1 | 2 |\n| B | 3 | 4 |", 1, 1],
    ["multiple header layers", "| Corner | Group | Value | < |\n| Name | Q1 | Q2 | Q3 |\n| --- | --- || --- | --- |\n| A | 1 | 2 | 3 |\n| B | 4 | 5 | 6 |", 2, 2],
  ] as const)("transposes %s with every logical cell and role", (_name, source, headerRows, rowHeaders) => {
    const before = parse(source);
    expect(before.headerRowCount).toBe(headerRows);
    expect(before.rowHeaderColumnCount).toBe(rowHeaders);
    const result = transposeTable(before);
    expect(result.changed).toBe(true);
    const after = parse(result.source);
    expectExactTranspose(before, after);
  });

  it("exchanges horizontal, vertical and two-dimensional merge geometry without treating literal markers as merges", () => {
    const before = parse(
      "| H1 | H2 | < |\n| --- || --- | --- |\n| Group | A | B |\n| ^ | C | D |",
    );
    const outcome = transposeTable(before);
    expect(outcome.changed).toBe(true);
    expectExactTranspose(before, parse(outcome.source));

    const complex = parse(
      "| --- | --- | --- |\n| One | < | \\< |\n| ^ | < | \\^ |",
    );
    const result = transposeTable(complex);
    expect(result.changed).toBe(true);
    const after = parse(result.source);
    expectExactTranspose(complex, after);
    expect(visibleContent(after, 2, 0)).toBe("<");
    expect(visibleContent(after, 2, 1)).toBe("^");
  });

  it("leaves uniformly aligned columns aligned and flags mixed alignment loss", () => {
    const uniform = parse("| A | B |\n| :---: | :---: |\n| x | y |");
    const preserved = planTransposeTable(uniform);
    expect(preserved.resetsColumnAlignment).toBe(false);
    expect(preserved.introducesStructuralSyntax).toBe(true);
    expect(parse(preserved.result.source).alignments).toEqual(["center", "center"]);
    const mixed = parse("| A | B |\n| :--- | ---: |\n| x | y |");
    const plan = planTransposeTable(mixed);
    expect(plan.resetsColumnAlignment).toBe(true);
    expect(plan.result.changed).toBe(true);
    expect(parse(plan.result.source).alignments).toEqual(["default", "default"]);
  });

  it.each([
    ["list continuation", "- Item\n\n    | Name | Value |\n    | --- | --- |\n    | North | 1 |"],
    ["nested list continuation", "- Outer\n  - Inner\n\n      | Name | Value |\n      | --- | --- |\n      | North | 1 |"],
    ["blockquote", "> Context\n> | Name | Value |\n> | --- | --- |\n> | North | 1 |"],
    ["nested blockquote", "> > | Name | Value |\n> > | --- | --- |\n> > | North | 1 |"],
    ["callout", "> [!note]\n> | Name | Value |\n> | --- | --- |\n> | North | 1 |"],
  ] as const)("flags the GFM to || transition inside a %s", (_name, source) => {
    const before = parse(source);
    expect(before.structural).toBe(false);
    const plan = planTransposeTable(before);
    expect(plan.result.changed).toBe(true);
    expect(plan.resetsColumnAlignment).toBe(false);
    expect(plan.introducesStructuralSyntax).toBe(true);
    const fullAfter = source.slice(0, before.range.from) + plan.result.source + source.slice(before.range.to);
    const after = parse(fullAfter);
    expect(after.structural).toBe(true);
    expect(after.rowHeaderColumnCount).toBe(1);
    expectExactTranspose(before, after);
  });

  it("does not invent tables or dialect conversions inside protected indented or fenced code", () => {
    for (const source of [
      "    | Name | Value |\n    | --- | --- |\n    | North | 1 |",
      "```md\n| Name | Value |\n| --- | --- |\n| North | 1 |\n```",
    ]) expect(parseEditableTables(source).tables).toHaveLength(0);
  });

  it("rejects header-only tables rather than inserting a fake data column", () => {
    const before = parse("| H1 | H2 |\n| Name | Value |\n| --- | --- |");
    const result = transposeTable(before);
    expect(result).toMatchObject({
      changed: false, code: "transpose-unrepresentable", source: before.source,
    });
  });

  it("treats a 1x1 headerless table as no-op without formatting the source", () => {
    const before = parse("| --- |\n| one |");
    expect(transposeTable(before)).toMatchObject({ changed: false, code: "table-transposed", source: before.source });
  });

  it("refuses hidden GFM overflow, malformed structural tables and delimiter-like false positives", () => {
    const overflow = parse("| A | B |\n| --- | --- |\n| x | y | hidden |");
    expect(transposeTable(overflow).changed).toBe(false);
    const invalid = parseEditableTables("| A | B |\n| --- || --- |\n| x | < |").tables[0]!;
    expect(transposeTable(invalid).changed).toBe(false);
  });

  it("keeps ordinary GFM ownership semantics and restores the logical table by transposing twice", () => {
    const ordinary = parse("| Name | Number |\n| --- | --- |\n| A | 1 |\n| B | 2 |");
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
    const before = parse("> | A | B |\r\n> | --- | --- |\r\n> | 1 | 2 |");
    const result = transposeTable(before);
    expect(result.changed).toBe(true);
    expect(result.source).toContain("\r\n> ");
    expect(result.source.split("\r\n").every((line) => line.startsWith("> "))).toBe(true);
    expectExactTranspose(before, parse(result.source));
  });
});
