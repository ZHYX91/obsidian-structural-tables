// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { planHtmlTableToMarkdown } from "../src/editor/html-table-conversion";
import { markdownTableToHtmlSource } from "../src/core/table-html-conversion";
import { parseEditableTables, parseStructuralTables } from "../src/core/parser";
import { validateDocumentReplacement } from "../src/core/document-replacement";
import { hasIsolatedTableBoundary, htmlTableSourceAt } from "../src/core/html-table-source";

const html = [
  "<table>",
  "  <thead><tr><th>Region</th><th colspan=\"2\">Sales</th></tr>",
  "  <tr><th>Quarter</th><th>Q1</th><th>Q2</th></tr></thead>",
  "  <tbody><tr><th scope=\"row\">North</th><td>10</td><td>12</td></tr></tbody>",
  "</table>",
].join("\n");

describe("HTML to Markdown source", () => {
  it("preserves row/column headers and merges with the existing extended syntax", () => {
    const plan = planHtmlTableToMarkdown(html)!;
    expect(plan).not.toBeNull();
    expect(plan.losesAttributes).toBe(false);
    expect(plan.source).toContain("||");
    const table = parseStructuralTables(plan.source).tables[0]!;
    expect(table).toMatchObject({
      valid: true, headerRowCount: 2, rowHeaderColumnCount: 1, columnCount: 3,
    });
    expect(table.rows[0]!.cells[1]).toMatchObject({ columnSpan: 2, role: "column_header" });
    expect(table.rows[2]!.cells[0]).toMatchObject({ role: "row_header" });
  });

  it("writes ordinary GFM when a single normal header row is enough", () => {
    const source = "<table><thead><tr><th>Item</th><th>Price</th></tr></thead>"
      + "<tbody><tr><td>A</td><td>10</td></tr></tbody></table>";
    const plan = planHtmlTableToMarkdown(source)!;
    expect(plan).not.toBeNull();
    expect(plan.source).not.toContain("||");
    expect(parseEditableTables(plan.source).tables[0]).toMatchObject({
      valid: true, structural: false, headerRowCount: 1,
    });
  });

  it("keeps headerless HTML rows as data without creating a fake header", () => {
    const source = "<table><tbody><tr><td>A</td><td>10</td></tr>"
      + "<tr><td>B</td><td>20</td></tr></tbody></table>";
    const plan = planHtmlTableToMarkdown(source)!;
    expect(plan).not.toBeNull();
    expect(parseStructuralTables(plan.source).tables[0]).toMatchObject({
      valid: true, headerRowCount: 0, rowHeaderColumnCount: 0,
    });
  });

  it("keeps row spans and covered cells", () => {
    const source = "<table><tbody><tr><th rowspan=\"2\">North</th><td>10</td></tr>"
      + "<tr><td>20</td></tr></tbody></table>";
    const plan = planHtmlTableToMarkdown(source)!;
    expect(plan).not.toBeNull();
    const parsed = parseStructuralTables(plan.source).tables[0]!;
    expect(parsed).toMatchObject({ valid: true, headerRowCount: 0, rowHeaderColumnCount: 1 });
    expect(parsed.rows[0]!.cells[0]!.rowSpan).toBe(2);
    expect(parsed.rows[1]!.cells[0]!.covered).toBe(true);
  });

  it("requires explicit acceptance when HTML styling and attributes would be lost", () => {
    const source = "<table class=\"wide\"><thead><tr><th>Item</th><th>Value</th></tr></thead>"
      + "<tbody><tr><td style=\"background: yellow\">A</td><td>10</td></tr></tbody></table>";
    const plan = planHtmlTableToMarkdown(source)!;
    expect(plan).not.toBeNull();
    expect(plan.losesAttributes).toBe(true);
    expect(plan.source).toContain("A");
    expect(plan.source).not.toContain("background");
  });

  it.each([
    "<table><tr><td>A</td><td>B</td></tr>",
    "<table><tr><td>A</td><td>B</tr></table>",
    "<table><tr><td><b>Important</b></td><td>2</td></tr></table>",
    "<table><tr><td><a href=\"/note\">Link</a></td><td>2</td></tr></table>",
    "<table><tr><td>A</td><td><img src=\"pic.png\"></td></tr></table>",
    "<table><tr><td>A</td><td>B</td></tr><caption>Meaning</caption></table>",
    "<table><tr><td hidden>A</td><td>B</td></tr></table>",
    "<table><tr><td rowspan=\"0\">A</td><td>B</td></tr></table>",
    "<table><tr><td colspan=\"-1\">A</td><td>B</td></tr></table>",
    "<table><tr><td>A</td><td>B</td></tr><tfoot><tr><td>Footer</td><td>X</td></tr></tfoot></table>",
    "<table><tr><th>A</th><td>B</td></tr><tr><td>X</td><td>2</td></tr></table>",
  ])("refuses malformed, unsafe or unrepresentable HTML", (source) => {
    expect(planHtmlTableToMarkdown(source)).toBeNull();
  });

  it("accepts source produced by the Markdown HTML exporter", () => {
    const markdown = "| Region | Sales | < |\n| Quarter | Q1 | Q2 |\n| --- || --- | --- |\n| North | 10 | 12 |";
    const table = parseStructuralTables(markdown).tables[0]!;
    const exported = markdownTableToHtmlSource(table, "tableconverttest")!;
    const converted = planHtmlTableToMarkdown(exported)!;
    expect(converted).not.toBeNull();
    const parsed = parseStructuralTables(converted.source).tables[0]!;
    expect(parsed.rows.map((row) => row.cells.map((cell) =>
      [cell.role, cell.anchorRow, cell.anchorColumn])))
      .toEqual(table.rows.map((row) => row.cells.map((cell) =>
        [cell.role, cell.anchorRow, cell.anchorColumn])));
  });

  it("keeps surrounding tables unchanged during a document-wide validation", () => {
    const note = [
      "| Before | Value |", "| --- | --- |", "| A | 1 |", "",
      html, "",
      "| After | Value |", "| --- | --- |", "| B | 2 |",
    ].join("\n");
    const target = htmlTableSourceAt(note, note.indexOf("<th>Region"))!;
    const converted = planHtmlTableToMarkdown(target.source)!;
    expect(hasIsolatedTableBoundary(note, target.range)).toBe(true);
    expect(validateDocumentReplacement(note, target.range, converted.source, true)).toBe(true);
    const updated = note.slice(0, target.range.from) + converted.source + note.slice(target.range.to);
    expect(updated).toContain("| Before | Value |");
    expect(updated).toContain("| After | Value |");
  });
});
