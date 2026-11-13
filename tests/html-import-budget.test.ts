// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import {
  HTML_TABLE_IMPORT_LIMITS,
  importedHtmlTableToStructuralSource,
  type ImportedHtmlCell,
  type ImportedHtmlRow,
} from "../src/core/interchange";
import { parseEditableTables } from "../src/core/parser";
import { planHtmlTableToMarkdown } from "../src/editor/html-table-conversion";
import { structuralSourceFromClipboardHtml, wholeTableClipboardImport } from "../src/editor/table-interchange";

function cell(options: Partial<ImportedHtmlCell> = {}): ImportedHtmlCell {
  return { text: "value", rowSpan: 1, columnSpan: 1, header: false, ...options };
}

function mergedRows(rowCount: number, columnCount: number): ImportedHtmlRow[] {
  return Array.from({ length: rowCount }, (_, row) => ({
    section: "body",
    cells: row === 0 ? [cell({ rowSpan: rowCount, columnSpan: columnCount })] : [],
  }));
}

function mergedHtml(rowCount: number, columnCount: number, text = "value"): string {
  return `<table><tbody><tr><td rowspan="${rowCount}" colspan="${columnCount}">${text}</td></tr>`
    + "<tr></tr>".repeat(rowCount - 1) + "</tbody></table>";
}

describe("shared HTML import expansion budget", () => {
  it("refuses a tiny input that would expand to forty thousand cells", () => {
    expect(importedHtmlTableToStructuralSource(mergedRows(40, 1000))).toEqual({ kind: "too-large" });
  });

  it("accepts the rectangular cell limit and refuses the next column", () => {
    const imported = importedHtmlTableToStructuralSource(mergedRows(100, 100));
    expect(imported.kind).toBe("table");
    if (imported.kind !== "table") throw new Error("Expected a bounded merged table.");
    const table = parseEditableTables(imported.source).tables[0]!;
    expect(table).toMatchObject({ valid: true, columnCount: 100 });
    expect(table.rows).toHaveLength(100);
    expect(table.rows[0]!.cells[0]).toMatchObject({ rowSpan: 100, columnSpan: 100 });
    expect(importedHtmlTableToStructuralSource(mergedRows(100, 101))).toEqual({ kind: "too-large" });
  });

  it("counts cumulative spans and padded rows in the rectangle", () => {
    const rows = mergedRows(100, 60);
    rows[0]!.cells = [cell({ columnSpan: 60 }), cell({ columnSpan: 41 })];
    expect(importedHtmlTableToStructuralSource(rows)).toEqual({ kind: "too-large" });
  });

  it.each([0, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "refuses non-positive or unsafe spans without allocating: %s", (span) => {
      for (const dimension of ["rowSpan", "columnSpan"] as const) {
        const rows: ImportedHtmlRow[] = [{ section: "body", cells: [cell({ [dimension]: span }), cell()] }];
        expect(importedHtmlTableToStructuralSource(rows)).toEqual({ kind: "unsupported" });
      }
    },
  );

  it("rejects a huge safe-integer column span without overflowing the grid budget", () => {
    expect(importedHtmlTableToStructuralSource(mergedRows(1, Number.MAX_SAFE_INTEGER))).toEqual({ kind: "too-large" });
  });

  it("refuses row spans beyond the supplied rows instead of silently clipping", () => {
    expect(importedHtmlTableToStructuralSource([
      { section: "body", cells: [cell({ rowSpan: 2 }), cell()] },
    ])).toEqual({ kind: "unsupported" });
  });

  it("bounds the row count before creating even the owners grid", () => {
    expect(importedHtmlTableToStructuralSource(mergedRows(5001, 2))).toEqual({ kind: "too-large" });
  });

  it.each([false, true])("budgets canonical column padding at the exact output limit (row headers=%s)", (header) => {
    const textLength = header ? 9889 : 9890;
    const rows: ImportedHtmlRow[] = Array.from({ length: 100 }, (_, row) => ({
      section: "body",
      cells: [cell({ text: row === 0 ? "x".repeat(textLength) : "", header }), cell({ text: "" })],
    }));
    const imported = importedHtmlTableToStructuralSource(rows);
    expect(imported.kind).toBe("table");
    if (imported.kind !== "table") throw new Error("Expected the exact output limit to fit.");
    expect(imported.source.length).toBe(HTML_TABLE_IMPORT_LIMITS.sourceCharacters);
    rows[0]!.cells[0]!.text += "x";
    expect(importedHtmlTableToStructuralSource(rows)).toEqual({ kind: "too-large" });
  });

  it("accounts for literal entities and wide characters before formatting", () => {
    for (const text of ["!".repeat(1979), "中".repeat(5000)]) {
      const rows: ImportedHtmlRow[] = Array.from({ length: 100 }, (_, row) => ({
        section: "body", cells: [cell({ text: row === 0 ? text : "" }), cell({ text: "" })],
      }));
      expect(importedHtmlTableToStructuralSource(rows)).toEqual({ kind: "too-large" });
    }
  });

  it("bounds input text before expanding its literal encoding", () => {
    expect(importedHtmlTableToStructuralSource([
      { section: "body", cells: [cell({ text: "!".repeat(HTML_TABLE_IMPORT_LIMITS.sourceCharacters + 1) }), cell()] },
    ])).toEqual({ kind: "too-large" });
  });

  it("preserves ordinary horizontal and vertical merges with literal Unicode text", () => {
    const imported = importedHtmlTableToStructuralSource([
      { section: "head", cells: [cell({ text: "地区", header: true }), cell({ text: "👩‍💻 Sales", columnSpan: 2, header: true })] },
      { section: "body", cells: [cell({ text: "North", rowSpan: 2, header: true }), cell({ text: "10" }), cell({ text: "20" })] },
      { section: "body", cells: [cell({ text: "é & cost" }), cell({ text: "30" })] },
    ]);
    expect(imported.kind).toBe("table");
    if (imported.kind !== "table") throw new Error("Expected an ordinary mixed-span table.");
    const table = parseEditableTables(imported.source).tables[0]!;
    expect(table).toMatchObject({ valid: true, headerRowCount: 1, rowHeaderColumnCount: 1, columnCount: 3 });
    expect(table.rows[0]!.cells[1]).toMatchObject({ columnSpan: 2 });
    expect(table.rows[1]!.cells[0]).toMatchObject({ rowSpan: 2 });
    expect(table.rows[2]!.cells[1]!.content).toBe("é &#38; cost");
  });
});

describe("HTML import entry budget agreement", () => {
  it.each([
    ["<code>value</code>", { kind: "plain", text: "COMPLETE-PLAIN-FALLBACK" }],
    ['<a href="note">value</a>', { kind: "native" }],
  ] as const)("keeps the existing unsupported-rich-HTML route without structural expansion: %s", async (text, expected) => {
    const importer = vi.spyOn(await import("../src/core/interchange"), "importedHtmlTableToStructuralSource");
    try {
      const html = mergedHtml(40, 1000, text);
      expect(wholeTableClipboardImport(html, "COMPLETE-PLAIN-FALLBACK")).toEqual(expected);
      expect(planHtmlTableToMarkdown(html)).toBeNull();
      expect(importer).not.toHaveBeenCalled();
    } finally { importer.mockRestore(); }
  });

  it.each(["value", ""])("blocks oversized safe HTML without falling back to plain text (text=%j)", (text) => {
    const html = mergedHtml(40, 1000, text);
    expect(html.length).toBeLessThan(500);
    expect(structuralSourceFromClipboardHtml(html)).toBeNull();
    expect(planHtmlTableToMarkdown(html)).toBeNull();
    expect(wholeTableClipboardImport(html, "COMPLETE-PLAIN-FALLBACK")).toEqual({ kind: "blocked-size" });
  });

  it("keeps both conversion routes consistent at the cell limit", () => {
    const html = mergedHtml(10, 1000);
    const source = structuralSourceFromClipboardHtml(html);
    expect(source).not.toBeNull();
    expect(planHtmlTableToMarkdown(html)?.source).toBe(source);
  });
});
