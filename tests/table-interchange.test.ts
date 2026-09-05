import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { singleCellTextFromClipboardHtml, structuralSourceFromClipboardHtml } from "../src/editor/table-interchange";
import { parseEditableTables } from "../src/core/parser";

const originalDomParser = globalThis.DOMParser;
const originalHtmlTable = globalThis.HTMLTableElement;

describe("HTML table clipboard import", () => {
  beforeEach(() => {
    const window = new Window();
    globalThis.DOMParser = window.DOMParser as unknown as typeof DOMParser;
    globalThis.HTMLTableElement = window.HTMLTableElement as unknown as typeof HTMLTableElement;
  });

  afterEach(() => {
    globalThis.DOMParser = originalDomParser;
    globalThis.HTMLTableElement = originalHtmlTable;
  });

  it("preserves rowspan, colspan, column headers, and row headers", () => {
    const source = structuralSourceFromClipboardHtml(`<table>
      <thead>
        <tr><th rowspan="2">Region</th><th colspan="2">Sales</th></tr>
        <tr><th>Q1</th><th>Q2</th></tr>
      </thead>
      <tbody>
        <tr><th rowspan="2">North</th><td>10</td><td>12</td></tr>
        <tr><td>8</td><td>11</td></tr>
      </tbody>
    </table>`);
    expect(source).toBe(`| Region  | Sales | <   |
| ^       | Q1    | Q2  |
| ---    || ---   | --- |
| North   | 10    | 12  |
| ^       | 8     | 11  |`);
    const parsed = parseEditableTables(source ?? "").tables[0];
    expect(parsed?.valid).toBe(true);
    expect(parsed?.headerRowCount).toBe(2);
    expect(parsed?.rowHeaderColumnCount).toBe(1);
  });

  it("treats the first row as headers when pasted HTML has only td cells", () => {
    expect(structuralSourceFromClipboardHtml("<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>"))
      .toBe("| A   | B   |\n| --- | --- |\n| 1   | 2   |");
  });

  it("preserves browser and spreadsheet cell line breaks as canonical br tags", () => {
    const source = structuralSourceFromClipboardHtml(`<table>
      <tr><th>Name</th><th>Note</th></tr>
      <tr><td>Alice</td><td>First<br>Second<br/>Third<br />Fourth</td></tr>
      <tr><td>Bob</td><td><div>Line one</div><div>Line two</div></td></tr>
    </table>`);

    expect(source).toBe(`| Name  | Note                               |
| ---   | ---                                |
| Alice | First<br>Second<br>Third<br>Fourth |
| Bob   | Line one<br>Line two               |`);
  });

  it("escapes HTML cell pipes without losing Wiki links or code spans", () => {
    const source = structuralSourceFromClipboardHtml(`<table>
      <tr><th>Name</th><th>Note</th></tr>
      <tr><td>Alice</td><td>[[Target|Alias]] | literal</td></tr>
    </table>`);
    const parsed = parseEditableTables(source ?? "").tables[0];

    expect(parsed?.columnCount).toBe(2);
    expect(parsed?.rows[1]?.cells[1]?.content).toBe(String.raw`[[Target\|Alias]] \| literal`);
  });

  it("returns null for non-tables and one-column tables", () => {
    expect(structuralSourceFromClipboardHtml("<p>Hello</p>")).toBeNull();
    expect(structuralSourceFromClipboardHtml("<table><tr><td>A</td></tr></table>")).toBeNull();
  });

  it("reads spreadsheet cell fragments without TSV quotes or the record terminator", () => {
    expect(singleCellTextFromClipboardHtml("\r\n  <td height=37 class=xl63>First<br\r\n  />\r\n    Second</td>\r\n"))
      .toBe("First\nSecond");
    expect(singleCellTextFromClipboardHtml('<table><tr><td>"Quoted"</td></tr></table>')).toBe('"Quoted"');
    expect(singleCellTextFromClipboardHtml("<td></td>")).toBe("");
    expect(singleCellTextFromClipboardHtml("<tr><td>A</td><td>B</td></tr>")).toBeNull();
    expect(singleCellTextFromClipboardHtml("<p>Ordinary text</p>")).toBeNull();
  });

  it("imports spreadsheet row fragments with their merge geometry", () => {
    const fragment = "<tr><td colspan=2>Group</td></tr><tr><td>A</td><td>B</td></tr>";
    const table = parseEditableTables(structuralSourceFromClipboardHtml(fragment) ?? "").tables[0];
    expect(table?.valid).toBe(true);
    expect(table?.rows[0]?.cells[0]?.columnSpan).toBe(2);
  });

  it("keeps the first complete span group as headers when Excel supplies only td cells", () => {
    const fragment = `<col width=51 span=2><col width=26>
      <tr><td rowspan=2>Region</td><td colspan=2>Sales</td></tr>
      <tr><td>Q1</td><td>Q2</td></tr>
      <tr><td rowspan=2>North</td><td>First</td><td rowspan=2>10</td></tr>
      <tr><td>Second</td></tr>`;
    const table = parseEditableTables(structuralSourceFromClipboardHtml(fragment) ?? "").tables[0];
    expect(table?.valid).toBe(true);
    expect(table?.headerRowCount).toBe(2);
    expect(table?.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(table?.rows[0]?.cells[1]?.columnSpan).toBe(2);
    expect(table?.rows[2]?.cells[0]?.rowSpan).toBe(2);
    expect(table?.rows[2]?.cells[2]?.rowSpan).toBe(2);
    expect(table?.rows[3]?.cells[1]?.content).toBe("Second");
  });

  it("refuses a span across an explicit header boundary instead of reclassifying data", () => {
    expect(structuralSourceFromClipboardHtml(`<table>
      <thead><tr><th rowspan=2>Region</th><th>Sales</th></tr></thead>
      <tbody><tr><td>10</td></tr></tbody>
    </table>`)).toBeNull();
  });
});
