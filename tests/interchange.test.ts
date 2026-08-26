import { describe, expect, it } from "vitest";

import {
  enabledConflictingPlugins,
  migrateSheetsExtendedTable,
  projectStructuralTable,
  structuralTableToDelimited,
  structuralTableToHtml,
  structuralTableToPlainGfm,
} from "../src/core/interchange";
import { parseEditableTables } from "../src/core/parser";

function table(source: string) {
  const parsed = parseEditableTables(source).tables[0];
  if (parsed === undefined) throw new Error("Expected a table fixture.");
  return parsed;
}

const STRUCTURAL = `| Region | Sales | < |
| Quarter | Q1 | Q2 |
| --- || --- | --- |
| North | 10 | 12 |
| ^ | 8 | 11 |`;

describe("table interchange", () => {
  it("projects multi-row headers and repeats merged row-header values", () => {
    expect(projectStructuralTable(table(STRUCTURAL))).toEqual({
      columnNames: ["Region / Quarter", "Sales / Q1", "Sales / Q2"],
      rows: [
        ["North", "10", "12"],
        ["North", "8", "11"],
      ],
      alignments: ["default", "default", "default"],
    });
  });

  it("flattens structural semantics into portable GFM", () => {
    expect(structuralTableToPlainGfm(table(STRUCTURAL))).toBe(`| Region / Quarter | Sales / Q1 | Sales / Q2 |
| --- | --- | --- |
| North | 10 | 12 |
| North | 8 | 11 |`);
  });

  it("exports semantic HTML with spans and scopes", () => {
    const html = structuralTableToHtml(table(STRUCTURAL));
    expect(html).toContain('<th colspan="2" scope="colgroup">Sales</th>');
    expect(html).toContain('<th rowspan="2" scope="rowgroup">North</th>');
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
  });

  it("exports quoted CSV and sanitized TSV", () => {
    const source = `| Name | Note |
| --- | --- |
| Alice | Hello, "world" |`;
    expect(structuralTableToDelimited(table(source), ",")).toBe('Name,Note\nAlice,"Hello, ""world"""');
    expect(structuralTableToDelimited(table(source), "\t")).toBe('Name\tNote\nAlice\tHello, "world"');
  });

  it("converts one Sheets Extended separator column into row-header syntax", () => {
    const source = `| Person | - | Q1 | Q2 |
| --- | --- | --- | --- |
| Alice | - | 1 | 2 |`;
    const migration = migrateSheetsExtendedTable(table(source));
    expect(migration?.separatorColumn).toBe(1);
    expect(migration?.source).toBe(`| Person | Q1 | Q2 |
| --- || --- | --- |
| Alice | 1 | 2 |`);
  });

  it("refuses ambiguous or edge separator columns", () => {
    expect(migrateSheetsExtendedTable(table(`| - | Name | Value |
| --- | --- | --- |
| - | A | 1 |`))).toBeNull();
    expect(migrateSheetsExtendedTable(table(`| Name | - | Value | - |
| --- | --- | --- | --- |
| A | - | 1 | - |`))).toBeNull();
  });

  it("reports enabled syntax conflicts once by product name", () => {
    expect(enabledConflictingPlugins(["sheets", "sheets-extended", "calendar", "table-master"]))
      .toEqual(["Sheets Extended", "Table Master"]);
  });
});
