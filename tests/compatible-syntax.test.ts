import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";

import { parseEditableTables, parseStructuralTables } from "../src/core/parser";
import { serializeStructuralTable } from "../src/core/serializer";
import { compatibleSource } from "../src/core/compatible-source";
import {
  appendTableRow,
  cellColumnAt,
  editCellContent,
  insertTableColumn,
  insertTableRow,
  setHeaderRowCount,
  setRowHeaderColumnCount,
  transposeTable,
} from "../src/core/operations";
import { importedHtmlTableToStructuralSource, structuralTableToHtml } from "../src/core/interchange";
import { tableCellSourceOffset } from "../src/editor/table-source-binding";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/config/settings";

const sample = [
  "| Region | << | Sales | < |",
  "| --- | --- | --- | --- |",
  "| Quarter | << | Q1 | Q2 |",
  "| ^^ | << | ^^ | ^^ |",
  "| North | << | 10 | 12 |",
  "| ^ | << | 8 | 11 |",
].join("\n");

const values = (source: string): string[][] => (
  parseEditableTables(source).tables[0]!.rows.map((row) => row.cells.map((cell) => cell.content))
);

describe("GFM-compatible Structural Tables source", () => {
  it("recognizes column/row boundary markers, merges and source positions without storing controls", () => {
    const table = parseStructuralTables(sample).tables[0]!;
    expect(table).toMatchObject({
      sourceSyntax: "compatible", structural: true, valid: true,
      headerRowCount: 2, rowHeaderColumnCount: 1, columnCount: 3,
      startLine: 0, delimiterLine: 1, endLine: 5,
    });
    expect(table.rows.map((row) => row.sourceLine)).toEqual([0, 2, 4, 5]);
    expect(table.rows[0]!.cells[1]).toMatchObject({ role: "column_header", columnSpan: 2 });
    expect(table.rows[3]!.cells[0]).toMatchObject({ covered: true, role: "row_header", anchorRow: 2 });
    expect(values(sample)).toEqual([
      ["Region", "Sales", ""], ["Quarter", "Q1", "Q2"],
      ["North", "10", "12"], ["", "8", "11"],
    ]);
    const sourcePosition = tableCellSourceOffset(sample, table, { row: 2, column: 1 });
    expect(sourcePosition).not.toBeNull();
    expect(sample.slice(sourcePosition!, sourcePosition! + 2)).toBe("10");
    const markerStart = sample.split("\n")[4]!.indexOf("<<");
    expect(cellColumnAt(sample.split("\n")[4]!, markerStart, table)).toBeNull();
    expect(cellColumnAt(sample.split("\n")[4]!, sample.split("\n")[4]!.indexOf("10"), table)).toBe(1);
  });

  it("recognizes headerless markers with or without row headers", () => {
    const plain = "| ^^ | ^^ |\n| --- | ---: |\n| Alice | 10 |\n| Bob | 20 |";
    const table = parseStructuralTables(plain).tables[0]!;
    expect(table).toMatchObject({ valid: true, sourceSyntax: "compatible", headerRowCount: 0, rowHeaderColumnCount: 0 });
    expect(values(plain)).toEqual([["Alice", "10"], ["Bob", "20"]]);
    const rowHeaders = "| ^^ | << | ^^ |\n| --- | --- | ---: |\n| Alice | << | 10 |";
    const withHeaders = parseStructuralTables(rowHeaders).tables[0]!;
    expect(withHeaders).toMatchObject({ valid: true, headerRowCount: 0, rowHeaderColumnCount: 1, columnCount: 2 });
    expect(withHeaders.rows[0]!.cells.map((cell) => cell.role)).toEqual(["row_header", "data"]);
    expect(serializeStructuralTable(withHeaders).split("\n")[0]).toContain("<<");
  });

  it("preserves both dialects and logical merge topology through explicit serialization", () => {
    const compact = "| Region | Sales | < |\n| Quarter | Q1 | Q2 |\n| --- || --- | --- |\n| North | 10 | 12 |\n| ^ | 8 | 11 |";
    const source = parseStructuralTables(compact).tables[0]!;
    const compatible = serializeStructuralTable({ ...source, sourceSyntax: "compatible" });
    const next = parseStructuralTables(compatible).tables[0]!;
    expect(next).toMatchObject({
      valid: true, sourceSyntax: "compatible", headerRowCount: 2,
      rowHeaderColumnCount: 1, columnCount: 3,
    });
    expect(next.rows.map((row) => row.cells.map((cell) => [
      cell.content, cell.role, cell.anchorRow, cell.anchorColumn,
    ]))).toEqual(source.rows.map((row) => row.cells.map((cell) => [
      cell.content, cell.role, cell.anchorRow, cell.anchorColumn,
    ])));
    const roundTrip = serializeStructuralTable({ ...next, sourceSyntax: "compact" });
    expect(parseStructuralTables(roundTrip).tables[0]!.sourceSyntax).toBe("compact");
    expect(values(roundTrip)).toEqual(values(compact));
  });

  it("produces one GFM parseable table with a normal second-line delimiter", () => {
    const markdown = new MarkdownIt();
    for (const source of [
      sample,
      "| ^^ | ^^ |\n| --- | --- |\n| A | 1 |",
      "| ^^ | << | ^^ |\n| --- | --- | --- |\n| A | << | 1 |",
    ]) {
      expect(markdown.render(source)).toContain("<table>");
      expect(markdown.render(source).match(/<table>/gu)).toHaveLength(1);
      expect(source.split("\n")[1]).toMatch(/^\| (?:-+(?: \| )?)+ \|$/u);
    }
  });

  it("does not consume literal, incomplete, or escaped lookalike markers", () => {
    const escaped = String.raw`| Key | Value |
| --- | --- |
| \^\^ | \<\< |`;
    const literal = parseEditableTables(escaped).tables[0]!;
    expect(literal.structural).toBe(false);
    expect(literal.rows[1]!.cells.map((cell) => cell.content)).toEqual(["^^", "<<"]);
    const incompleteColumn = "| Key | << | Value |\n| --- | --- | --- |\n| A | Other | 1 |";
    expect(parseStructuralTables(incompleteColumn).tables).toEqual([]);
    expect(parseEditableTables(incompleteColumn).tables[0]!.valid).toBe(true);
    const duplicateControlRow = "| ^^ | ^^ |\n| --- | --- |\n| ^^ | ^^ |\n| A | 1 |";
    expect(parseStructuralTables(duplicateControlRow).tables[0]!.valid).toBe(false);
  });

  it("preserves escaped marker text during compatible formatting", () => {
    const source = String.raw`| H | V |
| --- | --- |
| \^\^ | \<\< |`;
    const table = parseEditableTables(source).tables[0]!;
    const compatible = serializeStructuralTable({ ...table, sourceSyntax: "compatible" });
    expect(compatible).toContain(String.raw`\^\^`);
    expect(compatible).toContain(String.raw`\<\<`);
    expect(values(compatible)[1]).toEqual(["^^", "<<"]);
  });

  it("keeps syntax on cell edits, row/column changes and header changes", () => {
    const noMerge = "| Region | << | Sales | Quarter |\n| --- | --- | --- | --- |\n| North | << | 10 | Q1 |\n| South | << | 20 | Q2 |";
    let table = parseStructuralTables(noMerge).tables[0]!;
    const edits = [
      (source: typeof table) => editCellContent(source, 1, 1, "42"),
      (source: typeof table) => insertTableRow(source, 1, "after"),
      (source: typeof table) => insertTableColumn(source, 1, "after"),
      (source: typeof table) => setHeaderRowCount(source, 0),
      (source: typeof table) => setRowHeaderColumnCount(source, 2),
      appendTableRow,
    ];
    for (const op of edits) {
      const result = op(table);
      expect(result.changed, result.message).toBe(true);
      table = parseStructuralTables(result.source).tables[0]!;
      expect(table).toMatchObject({ valid: true, sourceSyntax: "compatible" });
      expect(result.source.split("\n")[1]).toContain("---");
    }
  });

  it("supports a compatible syntax transposition without leaking control cells", () => {
    const table = parseStructuralTables("| ^^ | << | ^^ |\n| --- | --- | --- |\n| Name | << | A |\n| Age | << | 28 |").tables[0]!;
    const result = transposeTable(table);
    expect(result.changed).toBe(true);
    const transposed = parseEditableTables(result.source).tables[0]!;
    expect(transposed.valid).toBe(true);
    expect(transposed.headerRowCount).toBe(1);
    expect(transposed.rowHeaderColumnCount).toBe(0);
    expect(transposed.rows.map((row) => row.cells.map((cell) => cell.content)))
      .toEqual([["Name", "Age"], ["A", "28"]]);
  });

  it("imports HTML into compatible source when selected and leaves existing compact source alone", () => {
    const rows = [
      { section: "head" as const, cells: [
        { text: "Name", rowSpan: 1, columnSpan: 1, header: true },
        { text: "Score", rowSpan: 1, columnSpan: 1, header: true },
      ] },
      { section: "body" as const, cells: [
        { text: "Alice", rowSpan: 1, columnSpan: 1, header: true },
        { text: "10", rowSpan: 1, columnSpan: 1, header: false },
      ] },
    ];
    const source = importedHtmlTableToStructuralSource(rows, "compatible");
    expect(source).not.toBeNull();
    const table = parseStructuralTables(source!).tables[0]!;
    expect(table).toMatchObject({ valid: true, sourceSyntax: "compatible", rowHeaderColumnCount: 1 });
    expect(structuralTableToHtml(table, "check")).toContain("Alice");
  });

  it("defaults new settings to compatible without replacing existing compact table source", () => {
    expect(DEFAULT_SETTINGS.defaultSourceSyntax).toBe("compatible");
    expect(sanitizeSettings({}).defaultSourceSyntax).toBe("compatible");
    expect(sanitizeSettings({ defaultSourceSyntax: "compact" }).defaultSourceSyntax).toBe("compact");
    expect(sanitizeSettings({ defaultSourceSyntax: "wrong" }).defaultSourceSyntax).toBe("compatible");
    const existing = "| A | B |\n| --- || --- |\n| Left | 1 |";
    expect(parseStructuralTables(existing).tables[0]!.sourceSyntax).toBe("compact");
    expect(serializeStructuralTable(parseStructuralTables(existing).tables[0]!)).toContain("||");
  });

  it("uses the selected syntax when ordinary GFM first receives specialized headers", () => {
    const original = parseEditableTables("| Name | Score |\n| --- | --- |\n| A | 1 |").tables[0]!;
    expect(original.structural).toBe(false);
    const selectedCompatible = setRowHeaderColumnCount(original, 1, "compatible");
    expect(selectedCompatible.changed).toBe(true);
    expect(parseStructuralTables(selectedCompatible.source).tables[0]).toMatchObject({
      valid: true, sourceSyntax: "compatible", rowHeaderColumnCount: 1,
    });
    const selectedCompact = setRowHeaderColumnCount(original, 1, "compact");
    expect(selectedCompact.changed).toBe(true);
    expect(parseStructuralTables(selectedCompact.source).tables[0]).toMatchObject({
      valid: true, sourceSyntax: "compact", rowHeaderColumnCount: 1,
    });
  });

  it("builds GFM-compatible physical rows with all data and headers in their original order", () => {
    const source = compatibleSource([["A", "B"], ["C", "D"]], 0, 1, ["default", "right"], "\n");
    const table = parseStructuralTables(source).tables[0]!;
    expect(table).toMatchObject({ valid: true, headerRowCount: 0, rowHeaderColumnCount: 1 });
    expect(values(source)).toEqual([["A", "B"], ["C", "D"]]);
  });
});
