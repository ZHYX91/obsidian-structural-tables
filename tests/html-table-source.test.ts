import { describe, expect, it } from "vitest";
import { hasIsolatedTableBoundary, htmlTableSourceAt, htmlTableSources } from "../src/core/html-table-source";

const table = "<table>\n<tr><td>A</td><td>B</td></tr>\n</table>";

describe("owned HTML source", () => {
  it("finds exact table boundaries without touching surrounding Markdown", () => {
    const note = ["Before", "", table, "", "| H | V |", "| --- | --- |", "| X | 1 |"].join("\n");
    const found = htmlTableSourceAt(note, note.indexOf("<td>A"));
    expect(found?.source).toBe(table);
    expect(note.slice(found!.range.from, found!.range.to)).toBe(table);
    expect(found?.startLine).toBe(2);
    expect(htmlTableSources(note)).toHaveLength(1);
  });

  it("recognizes a whole one-line table but not inline HTML", () => {
    const single = "<table><tr><td>A</td><td>B</td></tr></table>";
    expect(htmlTableSources(single)[0]?.source).toBe(single);
    expect(htmlTableSources("Before " + single)).toEqual([]);
    expect(htmlTableSources(single + " After")).toEqual([]);
  });

  it("does not claim fenced examples, comments, parent HTML or indented code", () => {
    const note = ["~~~html", table, "~~~", "", "<!--", table, "-->", "",
      "<div>", table, "</div>", "", "    " + table.replaceAll("\n", "\n    "),
      "", table].join("\n");
    const owned = htmlTableSources(note);
    expect(owned).toHaveLength(1);
    expect(owned[0]?.source).toBe(table);
  });

  it("refuses incomplete, nested and blank-line-split blocks", () => {
    expect(htmlTableSources("<table>\n<tr><td>A</td></tr>")).toEqual([]);
    expect(htmlTableSources("<table>\n\n<tr><td>A</td></tr>\n</table>")).toEqual([]);
    expect(htmlTableSources("<table>\n<table></table>\n</table>")).toEqual([]);
  });

  it("requires blank-line isolation before replacing complete HTML blocks", () => {
    const first = "Intro\n<table><tr><td>A</td></tr></table>\nOutro";
    const found = htmlTableSources(first)[0]!;
    expect(hasIsolatedTableBoundary(first, found.range)).toBe(false);
    const safe = "Intro\n\n<table><tr><td>A</td></tr></table>\n\nOutro";
    expect(hasIsolatedTableBoundary(safe, htmlTableSources(safe)[0]!.range)).toBe(true);
    const standalone = "<table><tr><td>A</td></tr></table>\n";
    expect(hasIsolatedTableBoundary(standalone, htmlTableSources(standalone)[0]!.range)).toBe(true);
  });

  it("preserves CRLF source offsets", () => {
    const note = "Intro\r\n\r\n" + table.replaceAll("\n", "\r\n") + "\r\nOutro";
    const found = htmlTableSourceAt(note, note.indexOf("<td>B"));
    expect(found?.source).toBe(table.replaceAll("\n", "\r\n"));
    expect(htmlTableSourceAt(note, 0)).toBeNull();
  });
});
