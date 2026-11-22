import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";

import {
  enabledConflictingPlugins,
  migrateSheetsExtendedTable,
  importedHtmlTableToStructuralSource,
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

  it("preserves native GFM columns when a code-looking span crosses cell delimiters", () => {
    const header = "| A | B | C |\n| --- | --- | --- |\n";
    const row = "| `part|two` | 7 |";
    const ordinary = table(header + row);
    expect(ordinary.structural).toBe(false);
    expect(ordinary.rows[1]!.sourceCellCount).toBe(3);
    expect(structuralTableToDelimited(ordinary, ",")).toBe("A,B,C\n`part,two`,7");
    const escaped = table(header + "| `part\\|two` | 7 | ok |");
    expect(escaped.rows[1]!.cells.map((cell) => cell.raw.trim())).toEqual(["`part\\|two`", "7", "ok"]);
    const structural = table(header.replace("--- | ---", "--- || ---") + row.replace(" | 7", " | middle | 7"));
    expect(structural.structural).toBe(true);
    expect(structural.rows[1]!.cells.map((cell) => cell.raw.trim())).toEqual(["`part|two`", "middle", "7"]);
  });

  it("flattens structural semantics into portable GFM", () => {
    expect(structuralTableToPlainGfm(table(STRUCTURAL))).toBe(`| Region / Quarter | Sales / Q1 | Sales / Q2 |
| --- | --- | --- |
| North | 10 | 12 |
| North | 8 | 11 |`);
  });

  it("pads all four alignments with native UTF-16 widths, including short delimiters", () => {
    const source = "| A | B | C | D |\n| --- | :--- | :---: | ---: |\n| 中 | 😀 | é | x |";
    const gfm = structuralTableToPlainGfm(table(source), "aligned");
    expect(gfm).toBe("| A   | B   |  C  |   D |\n| --- | :-- | :-: | --: |\n| 中   | 😀  | é  |   x |");
    expect(structuralTableToPlainGfm(table(gfm), "aligned")).toBe(gfm);
    const html = new MarkdownIt().render(gfm);
    expect((html.match(/<td/gu) ?? []).length).toBe(4);
    expect(html).toContain("😀");
  });

  it("pads empty headers and portable escaped or HTML source before conversion writes", () => {
    const source = "| --- || --- |\n| `a|b` | a\\|b |";
    const gfm = structuralTableToPlainGfm(table(source), "aligned");
    expect(gfm).toBe("|                       |      |\n| --------------------- | ---- |\n| <code>a&#124;b</code> | a\\|b |");
    expect(table(gfm)).toMatchObject({ valid: true, structural: false, headerRowCount: 1, columnCount: 2 });
    const html = new MarkdownIt({ html: true }).render(gfm);
    expect(html).toContain("<code>a|b</code>");
    expect(html).toContain("<td>a|b</td>");
  });

  it.each([
    "$5",
    String.raw`$\lvert x\rvert$`,
    String.raw`$P(A\mid B)$`,
  ])("preserves accepted existing source in portable GFM: %s", (content) => {
    const source = `| Label | Amount |\n| --- | --- |\n| A | ${content} |`;
    const output = structuralTableToPlainGfm(table(source));
    expect(output).toContain(`| A | ${content} |`);
  });

  it.each(["`a|b`", "``a|b``"])(
    "preserves code pipes in standard GFM without hiding later cells: %s", (cell) => {
      const input = ["| H1 | H2 |", "| --- || --- |", "| " + cell + " | KEEP |"].join("\n");
      const gfm = structuralTableToPlainGfm(table(input));
      const output = new MarkdownIt({ html: true }).render(gfm);
      expect(output).toContain("<td>KEEP</td>");
      expect(output).toContain("<code>a|b</code>");
      expect((output.match(/<td>/gu) ?? []).length).toBe(2);
    },
  );

  it.each([1, 2] as const)("keeps 0–5 literal backslashes in %i-backtick GFM code", (ticks) => {
    const fence = String.fromCharCode(96).repeat(ticks);
    const markdown = new MarkdownIt({ html: true });
    for (let count = 0; count <= 5; count += 1) {
      const visible = "a" + "\\".repeat(count) + "|b";
      const cell = fence + visible + fence;
      const source = ["| H1 | H2 |", "| --- || --- |", "| " + cell + " | KEEP |"].join("\n");
      const output = structuralTableToPlainGfm(table(source));
      const rendered = markdown.render(output);
      expect(rendered, cell).toContain("<code>" + visible + "</code>");
      expect(rendered, cell).toContain("<td>KEEP</td>");
      expect((rendered.match(/<td>/gu) ?? []).length, cell).toBe(2);
      expect(output, cell).toContain("<code>");
      // Obsidian's native renderer also uses inline code without GFM's
      // table-level pipe unescape. The same exported cell must work there.
      const exportedCell = output.split("\n")[2]!.split("|")[1]!.trim();
      expect(markdown.renderInline(exportedCell), cell).toBe("<code>" + visible + "</code>");
    }
  });

  it.each([
    "**literal**|end", "[name](example.md)|x", "~~old~~|new", "www.example.org|tail",
    "a`b`|c", "[[note|alias]]", "&#42;|&amp;", "<em>x</em>|done",
  ])("renders a pipe-containing code span as literal text in both GFM and inline Markdown: %s", (value) => {
    const source = ["| H | V |", "| --- || --- |", "| ``" + value + "`` | **keep** |"].join("\n");
    const gfm = structuralTableToPlainGfm(table(source));
    const markdown = new MarkdownIt({ html: true, linkify: true });
    const expected = "<code>" + markdown.utils.escapeHtml(value) + "</code>";
    expect(markdown.render(gfm)).toContain("<td>" + expected + "</td>\n<td><strong>keep</strong></td>");
    expect(markdown.renderInline(gfm.split("\n")[2]!.split("|")[1]!.trim())).toBe(expected);
  });

  it("retains padded code spans and HTML-sensitive literals without losing columns", () => {
    const tick = String.fromCharCode(96);
    for (const value of ["a\\|b & <c> 😊", " a\\|b & <c> 😊 "]) {
      const code = tick.repeat(2) + value + tick.repeat(2);
      const input = ["| H | V |", "| --- || --- |", "| " + code + " | KEEP |"].join("\n");
      const rendered = new MarkdownIt({ html: true }).render(structuralTableToPlainGfm(table(input)));
      const display = value.startsWith(" ") ? value.slice(1, -1) : value;
      const encoded = display.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
      expect(rendered).toContain("<code>" + encoded + "</code>");
      expect(rendered).toContain("<td>KEEP</td>");
    }
  });

  it("preserves code-text slashes projected through a GFM column header", () => {
    const tick = String.fromCharCode(96);
    const value = "a" + "\\" + "|b";
    const source = ["| H | " + tick + value + tick + " |", "| --- || --- |", "| row | KEEP |"].join("\n");
    const html = new MarkdownIt({ html: true }).render(structuralTableToPlainGfm(table(source)));
    expect(html).toContain("<code>" + value + "</code>");
    expect(html).toContain("<td>KEEP</td>");
  });

  it("exports semantic HTML with spans and scopes", () => {
    const html = structuralTableToHtml(table(STRUCTURAL), "test");
    expect(html).toContain('<th colspan="2" id="test-r0-c1" headers="">Sales</th>');
    expect(html).toContain('<th rowspan="2" id="test-r2-c0" headers="test-r0-c0 test-r1-c0">North</th>');
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
  });

  it("exports headerless tables without inventing CSV headers or HTML thead", () => {
    const source = "| --- || --- |\n| Alice | 10 |\n| Bob | 20 |";
    const parsed = table(source);

    expect(projectStructuralTable(parsed)).toEqual({
      columnNames: ["Column 1", "Column 2"],
      rows: [["Alice", "10"], ["Bob", "20"]],
      alignments: ["default", "default"],
    });
    expect(structuralTableToDelimited(parsed, ",")).toBe("Alice,10\nBob,20");
    expect(structuralTableToDelimited(parsed, "\t")).toBe("Alice\t10\nBob\t20");
    expect(structuralTableToPlainGfm(parsed)).toBe("|  |  |\n| --- | --- |\n| Alice | 10 |\n| Bob | 20 |");
    const html = structuralTableToHtml(parsed, "test");
    expect(html).not.toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain('<th scope="row">Alice</th>');
  });

  it.each(["<br>", "<br/>", "<br />"])("exports %s as a semantic HTML line break", (tag) => {
    const source = `| Name | Note |\n| --- || --- |\n| Alice | First${tag}Second |`;

    expect(structuralTableToHtml(table(source), "test")).toContain("First<br>Second");
  });

  it("exports HTML-imported literal data and headers to delimited text exactly once", () => {
    const data = [
      ["A&B", "Total (USD)"],
      ["AT&T", "USD 1.50"],
      ['"Hello, world"', "literal &#38;"],
      ["<br>", "first\nsecond"],
    ];
    const imported = importedHtmlTableToStructuralSource(data.map((row, i) => ({
      section: i === 0 ? "head" : "body",
      cells: row.map(text => ({ text, header: i === 0, rowSpan: 1, columnSpan: 1 })),
    })));
    if (imported.kind !== "table") throw new Error("Expected imported table");
    const parsed = table(imported.source);
    expect(structuralTableToDelimited(parsed, ",")).toBe('A&B,Total (USD)\nAT&T,USD 1.50\n"""Hello, world""",literal &#38;\n<br>,first second');
    expect(structuralTableToDelimited(parsed, "\t")).toBe('A&B\tTotal (USD)\nAT&T\tUSD 1.50\n"Hello, world"\tliteral &#38;\n<br>\tfirst second');
  });

  it("preserves authored code, links and complex Markdown in direct delimited copies", () => {
    const cells = ["`&#38;`", "[A&#38;B](ref)", "$a&#38;b$", "**A&#38;B**", "&#38;nbsp;"];
    const input = "| H1 | H2 | H3 | H4 | H5 |\n| --- | --- | --- | --- | --- |\n| " + cells.join(" | ") + " |";
    expect(structuralTableToDelimited(table(input), "\t").split("\n")[1]).toBe(cells.join("\t"));
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
    expect(migration?.source).toBe(`| Person  | Q1  | Q2  |
| ---    || --- | --- |
| Alice   | 1   | 2   |`);
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
