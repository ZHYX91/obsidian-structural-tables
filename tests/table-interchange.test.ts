import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Editor } from "obsidian";

import {
  cellClipboardText,
  replaceSelectionFromClipboardTable,
  singleCellTextFromClipboardHtml,
  structuralSourceFromClipboardHtml,
  wholeTableClipboardImport,
} from "../src/editor/table-interchange";
import { parseEditableTables } from "../src/core/parser";

const originalDomParser = globalThis.DOMParser;
const originalHtmlTable = globalThis.HTMLTableElement;

describe("HTML table clipboard import", () => {
  it.each(["&lt;!--", "%%"])("does not import a truncated table containing %s", content => {
    expect(structuralSourceFromClipboardHtml(`<table><tr><th>H</th><th>V</th></tr><tr><td>${content}</td><td>KEEP-1</td></tr><tr><td>B</td><td>KEEP-2</td></tr></table>`)).toBeNull();
  });
  it.each([
    "<p>Before</p><table><tr><td>A</td></tr></table><p>After</p>",
    "<table><tr><td>A</td></tr></table><table><tr><td>B</td></tr></table>",
    "<table><caption>Title</caption><tr><td>A</td></tr></table>",
  ])("does not truncate mixed single-cell content: %s", (html) => {
    expect(singleCellTextFromClipboardHtml(html)).toBeNull();
    expect(cellClipboardText(html, "Complete clipboard")).toEqual({ kind: "text", text: "Complete clipboard", fallback: true });
    expect(cellClipboardText(html, "")).toEqual({ kind: "unsupported" });
  });

  it.each([
    "<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>",
    '<img src="image.png" alt="diagram">',
    '<a href="Note" class="internal-link">Alias</a>',
    '<span class="internal-embed">Title</span>',
    '<input value="data">',
  ])("declines lossy text extraction even when rich HTML has text: %s", (content) => {
    const cell = `<td>Before ${content} after</td>`;
    expect(singleCellTextFromClipboardHtml(cell)).toBeNull();
    expect(structuralSourceFromClipboardHtml(`<table><tr>${cell}<td>B</td></tr></table>`)).toBeNull();
    expect(cellClipboardText(cell, "")).toEqual({ kind: "unsupported" });
    expect(cellClipboardText(cell, "original source")).toEqual({ kind: "text", text: "original source", fallback: true });
  });

  it("distinguishes intentionally empty cells from missing data and prefers meaningful plain text", () => {
    expect(cellClipboardText("<td></td>", "")).toEqual({ kind: "empty" });
    expect(cellClipboardText("<td></td>", "preserve me")).toEqual({ kind: "text", text: "preserve me", fallback: true });
    expect(cellClipboardText("", "")).toEqual({ kind: "unsupported" });
    expect(cellClipboardText("", "plain")).toEqual({ kind: "text", text: "plain", fallback: false });
    expect(cellClipboardText("<td>A<br>B</td>", '"A\nB"\r\n')).toEqual({ kind: "text", text: "A\nB", fallback: false });
  });

  it.each([
    ["preformatted whitespace", "<td><pre>A\n  B\tC</pre></td>", "A\n  B\tC"],
    ["superscript", "<td>x<sup>2</sup></td>", "x²"],
    ["subscript", "<td>H<sub>2</sub>O</td>", "H₂O"],
  ])("falls back to complete plain text for %s", (_name, html, plain) => {
    expect(singleCellTextFromClipboardHtml(html)).toBeNull();
    expect(cellClipboardText(html, plain)).toEqual({ kind: "text", text: plain, fallback: true });
    expect(cellClipboardText(html, "")).toEqual({ kind: "unsupported" });
  });
  beforeEach(() => {
    const window = new Window();
    globalThis.DOMParser = window.DOMParser as unknown as typeof DOMParser;
    globalThis.HTMLTableElement = window.HTMLTableElement as unknown as typeof HTMLTableElement;
  });

  afterEach(() => {
    globalThis.DOMParser = originalDomParser;
    globalThis.HTMLTableElement = originalHtmlTable;
  });

  it.each(["0", "00", "000"])(
    "preserves rowspan=%s through the remainder of its row group without trusting the DOM getter",
    (rowspan) => {
      const source = structuralSourceFromClipboardHtml(`<table>
        <thead><tr><th>Group</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td rowspan="${rowspan}">North</td><td>A</td></tr>
          <tr><td>B</td></tr>
        </tbody>
      </table>`);
      const parsed = parseEditableTables(source ?? "").tables[0]!;
      expect(parsed.rows[1]?.cells[0]?.rowSpan).toBe(2);
      expect(parsed.rows[2]?.cells[0]?.covered).toBe(true);
      expect(parsed.rows[2]?.cells[1]?.content).toBe("B");
    },
  );

  it("keeps an ordinary positive rowspan bounded to its declared count", () => {
    const source = structuralSourceFromClipboardHtml(`<table>
      <thead><tr><th>Group</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td rowspan="2">North</td><td>A</td></tr>
        <tr><td>B</td></tr>
        <tr><td>South</td><td>C</td></tr>
      </tbody>
    </table>`);
    const parsed = parseEditableTables(source ?? "").tables[0]!;
    expect(parsed.rows[1]?.cells[0]?.rowSpan).toBe(2);
    expect(parsed.rows[2]?.cells[0]?.covered).toBe(true);
    expect(parsed.rows[3]?.cells[0]?.content).toBe("South");
    expect(parsed.rows[3]?.cells[1]?.content).toBe("C");
  });

  it.each([
    ["missing", ""],
    ["empty", 'rowspan=""'],
    ["non-numeric", 'rowspan="invalid"'],
    ["negative", 'rowspan="-1"'],
    ["signed zero", 'rowspan="+0"'],
    ["hex-like zero", 'rowspan="0x0"'],
  ])("does not reinterpret a %s rowspan attribute as zero-span", (_name, attribute) => {
    const source = structuralSourceFromClipboardHtml(`<table>
      <thead><tr><th>Group</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td ${attribute}>North</td><td>A</td></tr>
        <tr><td>South</td><td>B</td></tr>
      </tbody>
    </table>`);
    const parsed = parseEditableTables(source ?? "").tables[0]!;
    expect(parsed.rows[1]?.cells[0]?.rowSpan).toBe(1);
    expect(parsed.rows[2]?.cells[0]?.covered).toBe(false);
    expect(parsed.rows[2]?.cells[0]?.content).toBe("South");
    expect(parsed.rows[2]?.cells[1]?.content).toBe("B");
  });

  it("keeps rowspan=0 within one tbody instead of crossing into the next row group", () => {
    const source = structuralSourceFromClipboardHtml(`<table>
      <thead><tr><th>Group</th><th>Value</th></tr></thead>
      <tbody><tr><td rowspan="0">First</td><td>A</td></tr></tbody>
      <tbody><tr><td>Second</td><td>B</td></tr></tbody>
    </table>`);
    const parsed = parseEditableTables(source ?? "").tables[0]!;
    expect(parsed.rows[1]?.cells[0]?.content).toBe("First");
    expect(parsed.rows[2]?.cells[0]?.content).toBe("Second");
    expect(parsed.rows[2]?.cells[0]?.covered).toBe(false);
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

  it("refuses mixed prose or multiple tables so native paste can preserve all content", () => {
    expect(structuralSourceFromClipboardHtml("<p>Before</p><table><tr><td>A</td><td>B</td></tr></table>")).toBeNull();
    expect(structuralSourceFromClipboardHtml(
      "<table><tr><td>A</td><td>B</td></tr></table><table><tr><td>C</td><td>D</td></tr></table>",
    )).toBeNull();
  });

  it.each([
    ["mixed prose", "<p>Before</p><table><tr><td>x<sup>2</sup></td><td>2</td></tr></table>", "fallback"],
    ["multiple tables", "<table><tr><td>x<sup>2</sup></td><td>2</td></tr></table><table><tr><td>A</td><td>B</td></tr></table>", "fallback"],
    ["superscript plus image", '<table><tr><td>x<sup>2</sup><img src="x.png"></td><td>2</td></tr></table>', "x²\t2"],
    ["superscript plus link", '<table><tr><td>x<sup>2</sup> <a href="https://example.com">source</a></td><td>2</td></tr></table>', "x² source\t2"],
  ])("leaves %s to native whole-note paste without touching the selection", (_name, html, plain) => {
    expect(wholeTableClipboardImport(html, plain)).toEqual({ kind: "native" });
    const replaceSelection = vi.fn();
    const clipboardData = {
      getData: (type: string) => type === "text/html" ? html : plain,
    } as unknown as DataTransfer;
    const editor = { replaceSelection } as unknown as Editor;

    expect(replaceSelectionFromClipboardTable(clipboardData, editor)).toBe("native");
    expect(replaceSelection).not.toHaveBeenCalled();
  });

  it.each([
    ["superscript", "<table><tr><td>x<sup>2</sup></td><td>2</td></tr></table>", "x²\t2"],
    ["subscript", "<table><tr><td>H<sub>2</sub>O</td><td>water</td></tr></table>", "H₂O\twater"],
    ["negative exponent", "<table><tr><td>x<sup>-2</sup></td><td>2</td></tr></table>", "x⁻²\t2"],
    ["nested superscript", "<table><tr><td>x<sup><span>2</span></sup></td><td>2</td></tr></table>", "x²\t2"],
    ["preformatted whitespace", "<table><tr><td><pre>A\n  B\tC</pre></td><td>2</td></tr></table>", "A\n  B\tC\t2"],
  ])("uses the complete plain fallback for a single text-semantic table: %s", (_name, html, plain) => {
    expect(wholeTableClipboardImport(html, plain)).toEqual({ kind: "plain", text: plain });
    const replaceSelection = vi.fn();
    const clipboardData = {
      getData: (type: string) => type === "text/html" ? html : plain,
    } as unknown as DataTransfer;
    const editor = { replaceSelection } as unknown as Editor;

    expect(replaceSelectionFromClipboardTable(clipboardData, editor)).toBe("plain");
    expect(replaceSelection).toHaveBeenCalledOnce();
    expect(replaceSelection).toHaveBeenCalledWith(plain);
  });

  it.each([
    ["superscript", "<table><tr><td>x<sup>2</sup></td><td>2</td></tr></table>"],
    ["subscript", "<table><tr><td>H<sub>2</sub>O</td><td>water</td></tr></table>"],
    ["preformatted text", "<table><tr><td><pre>A\n  B</pre></td><td>2</td></tr></table>"],
  ])("blocks a single text-semantic table without a plain fallback: %s", (_name, html) => {
    expect(wholeTableClipboardImport(html, "")).toEqual({ kind: "blocked-unsafe-text" });
    const replaceSelection = vi.fn();
    const clipboardData = {
      getData: (type: string) => type === "text/html" ? html : "",
    } as unknown as DataTransfer;
    const editor = { replaceSelection } as unknown as Editor;

    expect(replaceSelectionFromClipboardTable(clipboardData, editor)).toBe("blocked-unsafe-text");
    expect(replaceSelection).not.toHaveBeenCalled();
  });

  it.each([
    ["plain text", "IMPORTANT-PLAIN"],
    ["multiline and surrounding whitespace", "  first line\nsecond line\n  "],
    ["whitespace-only non-empty text", " \n "],
  ])("uses the complete plain fallback for a pure empty table: %s", (_name, plain) => {
    const html = "<table><tr><td></td><td></td></tr></table>";
    expect(wholeTableClipboardImport(html, plain)).toEqual({ kind: "plain", text: plain });
    const replaceSelection = vi.fn();
    const clipboardData = {
      getData: (type: string) => type === "text/html" ? html : plain,
    } as unknown as DataTransfer;
    const editor = { replaceSelection } as unknown as Editor;

    expect(replaceSelectionFromClipboardTable(clipboardData, editor)).toBe("plain");
    expect(replaceSelection).toHaveBeenCalledOnce();
    expect(replaceSelection).toHaveBeenCalledWith(plain);
  });

  it("blocks a pure empty HTML table when no plain alternative exists", () => {
    const html = "<table><tr><td></td><td></td></tr></table>";
    expect(wholeTableClipboardImport(html, "")).toEqual({ kind: "blocked-empty" });
    const replaceSelection = vi.fn();
    const clipboardData = {
      getData: (type: string) => type === "text/html" ? html : "",
    } as unknown as DataTransfer;
    const editor = { replaceSelection } as unknown as Editor;

    expect(replaceSelectionFromClipboardTable(clipboardData, editor)).toBe("blocked-empty");
    expect(replaceSelection).not.toHaveBeenCalled();
  });

  it("leaves an entirely empty clipboard native", () => {
    expect(wholeTableClipboardImport("", "")).toEqual({ kind: "native" });
  });

  it("owns a supported whole-note table paste and replaces the selection once", () => {
    const replaceSelection = vi.fn();
    const clipboardData = {
      getData: (type: string) => type === "text/html"
        ? "<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>"
        : "A\tB\n1\t2",
    } as unknown as DataTransfer;
    const editor = { replaceSelection } as unknown as Editor;

    expect(wholeTableClipboardImport(
      clipboardData.getData("text/html"),
      clipboardData.getData("text/plain"),
    ).kind).toBe("table");
    expect(replaceSelectionFromClipboardTable(clipboardData, editor)).toBe("table");
    expect(replaceSelection).toHaveBeenCalledOnce();
    expect(replaceSelection.mock.calls[0]?.[0]).toContain("| A");
  });

  it("falls back from non-text rich single cells while preserving truly empty cells", () => {
    expect(singleCellTextFromClipboardHtml(
      "<table><tr><td><mjx-container><svg><path></path></svg></mjx-container></td></tr></table>",
    )).toBeNull();
    expect(singleCellTextFromClipboardHtml("<table><tr><td></td></tr></table>")).toBe("");
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
