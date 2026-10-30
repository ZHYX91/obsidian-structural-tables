import { describe, expect, it } from "vitest";
import { parseEditableTables, parseStructuralTables } from "../src/core/parser";
import { markdownTableToHtmlSource } from "../src/core/table-html-conversion";
import { hasIsolatedTableBoundary, htmlTableSourceAt } from "../src/core/html-table-source";
import { validateDocumentReplacement } from "../src/core/document-replacement";

const structural = "| Region | Sales | < |\n| Quarter | Q1 | Q2 |\n| --- || --- | --- |\n| North | 10 | 12 |";

describe("Markdown to HTML source", () => {
  it("preserves complex header roles and merged cell spans in HTML", () => {
    const table = parseStructuralTables(structural).tables[0]!;
    const html = markdownTableToHtmlSource(table, "htmlconversiontest")!;
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain('colspan="2"');
    expect(html).toContain("North");
    expect(html).not.toContain("| ---");
  });

  it("allows headerless tables and preserves CRLF", () => {
    const source = "| --- | --- |\r\n| A | 1 |\r\n| B | 2 |";
    const table = parseStructuralTables(source).tables[0]!;
    const html = markdownTableToHtmlSource(table, "htmlconversiontest")!;
    expect(html).not.toContain("<thead>");
    expect(html).toContain("\r\n");
    expect(html).not.toMatch(/(?<!\r)\n/u);
  });

  it("refuses Markdown semantics and hidden source cells rather than flattening them", () => {
    const examples = [
      "| Name | Value |\n| --- | --- |\n| A | **bold** |",
      "| Name | Value |\n| --- | --- |\n| A | [[Note]] |",
      "| Name | Value |\n| --- | --- |\n| A | $x^2$ |",
      "| Name | Value |\n| --- | --- |\n| A | &amp; |",
      "| Name | Value |\n| --- | --- |\n| A | V | hidden |",
    ];
    for (const source of examples) {
      const table = parseEditableTables(source).tables[0]!;
      expect(markdownTableToHtmlSource(table, "htmlconversiontest"), source).toBeNull();
    }
    const quoted = parseStructuralTables("> | --- | --- |\n> | A | 1 |").tables[0]!;
    expect(markdownTableToHtmlSource(quoted, "htmlconversiontest")).toBeNull();
  });

  it("does not absorb neighboring tables when replacing its exact range", () => {
    const note = [
      "| Before | Value |", "| --- | --- |", "| A | 1 |", "",
      structural, "",
      "| After | Value |", "| --- | --- |", "| B | 2 |",
    ].join("\n");
    const table = parseStructuralTables(note).tables[0]!;
    const html = markdownTableToHtmlSource(table, "htmlconversiontest")!;
    const next = note.slice(0, table.range.from) + html + note.slice(table.range.to);
    expect(hasIsolatedTableBoundary(note, table.range)).toBe(true);
    expect(validateDocumentReplacement(note, table.range, html)).toBe(true);
    expect(htmlTableSourceAt(next, table.range.from + 1)?.source).toBe(html);
    expect(next).toContain("| Before | Value |");
    expect(next).toContain("| After | Value |");
  });
});
