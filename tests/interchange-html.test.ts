// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { structuralTableToHtml } from "../src/core/interchange";
import { parseEditableTables } from "../src/core/parser";
import { structuralSourceFromClipboardHtml } from "../src/editor/table-interchange";

const fixture = readFileSync("acceptance/fixtures/Complex HTML copy.md", "utf8");

function exportedTable(source: string, prefix = "test"): HTMLTableElement {
  const parsed = parseEditableTables(source).tables[0]!;
  expect(parsed.valid).toBe(true);
  return new DOMParser().parseFromString(structuralTableToHtml(parsed, prefix), "text/html").querySelector("table")!;
}

function cellWithText(table: HTMLTableElement, text: string): HTMLTableCellElement {
  const cell = [...table.querySelectorAll<HTMLTableCellElement>("th, td")].find((candidate) => candidate.textContent === text);
  if (cell === undefined) throw new Error(`Missing cell: ${text}`);
  return cell;
}

function headerTexts(table: HTMLTableElement, cell: HTMLTableCellElement): string[] {
  return (cell.getAttribute("headers") ?? "").split(" ").filter(Boolean).map((id) => {
    const header = table.ownerDocument.getElementById(id);
    expect(header?.tagName).toBe("TH");
    expect(table.contains(header)).toBe(true);
    return header!.textContent!;
  });
}

describe("whole-table HTML header relationships", () => {
  it("keeps simple row and column scopes without inventing groups or IDs", () => {
    const output = exportedTable("| Region | Value |\n| --- || --- |\n| North | 1 |\n| South | 2 |");
    expect(cellWithText(output, "Value").scope).toBe("col");
    expect(cellWithText(output, "North").scope).toBe("row");
    expect(cellWithText(output, "Region").scope).toBe("");
    expect(output.querySelector("[id], [headers], colgroup")).toBeNull();
  });

  it("associates every overlapping header for 2D data merges and crossing row-header groups", () => {
    const parsed = parseEditableTables(fixture).tables[0]!;
    const output = exportedTable(parsed.source);
    const merged = cellWithText(output, "10");
    expect(merged.rowSpan).toBe(2);
    expect(merged.colSpan).toBe(2);
    expect(headerTexts(output, merged)).toEqual(["Year", "Q1", "A", "B", "North", "Basic", "Premium"]);
    expect(headerTexts(output, cellWithText(output, "30"))).toEqual(["Year", "Q1", "A", "Premium", "South"]);
    expect(headerTexts(output, cellWithText(output, "40"))).toEqual(["Year", "Q1", "A", "South", "Other"]);
    expect(headerTexts(output, cellWithText(output, "Premium"))).toEqual(["Item", "North", "South"]);
    expect(headerTexts(output, cellWithText(output, "North"))).toEqual(["Region"]);
    expect(headerTexts(output, cellWithText(output, "Q2"))).toEqual(["Year"]);
    expect(output.querySelector('[scope="rowgroup"], [scope="colgroup"], colgroup')).toBeNull();
    expect(cellWithText(output, "Basic").scope).toBe("row");
    expect(cellWithText(output, "A").scope).toBe("col");
    const ids = [...output.querySelectorAll("th")].map((cell) => cell.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(output.querySelectorAll("[headers]")).toHaveLength(output.querySelectorAll("th, td").length);
    expect(cellWithText(output, "Year").getAttribute("headers")).toBe("");
  });

  it("explicitly associates simple headers with every row and column of a merged data cell", () => {
    const output = exportedTable(`| Region | One | Two |
| --- || --- | --- |
| North | 10 | < |
| South | ^ | ^ |`);
    expect(headerTexts(output, cellWithText(output, "10"))).toEqual(["One", "Two", "North", "South"]);
    expect(cellWithText(output, "One").scope).toBe("col");
    expect(cellWithText(output, "South").scope).toBe("row");
  });

  it("deduplicates a row header spanning both row-header columns and multiple rows", () => {
    const output = exportedTable(`| --- | --- || --- | --- |
| North | < | 1 | 2 |
| ^ | ^ | 3 | 4 |
| South | A | 5 | 6 |`);
    expect(headerTexts(output, cellWithText(output, "3"))).toEqual(["North"]);
    expect(headerTexts(output, cellWithText(output, "5"))).toEqual(["South", "A"]);
  });

  it("never relates unrelated columns, rows, or corner titles to data", () => {
    const output = exportedTable(parseEditableTables(fixture).tables[0]!.source);
    const texts = headerTexts(output, cellWithText(output, "13"));
    expect(texts).toEqual(["Year", "Q2", "B", "North", "Basic"]);
    for (const unrelated of ["Q1", "A", "South", "Premium", "Other", "Region", "Item"]) expect(texts).not.toContain(unrelated);
    expect(headerTexts(output, cellWithText(output, "Region"))).toEqual([]);
    expect(cellWithText(output, "Region").getAttribute("headers")).toBe("");
  });

  it("handles staggered column spans without losing a parent or adding disjoint headers", () => {
    const output = exportedTable(`| Left | < | Right | < |
| X | Middle | < | Z |
| --- | --- | --- | --- |
| 1 | 2 | 3 | 4 |`);
    expect(headerTexts(output, cellWithText(output, "Middle"))).toEqual(["Left", "Right"]);
    expect(headerTexts(output, cellWithText(output, "2"))).toEqual(["Left", "Middle"]);
    expect(headerTexts(output, cellWithText(output, "3"))).toEqual(["Right", "Middle"]);
    expect(headerTexts(output, cellWithText(output, "4"))).toEqual(["Right", "Z"]);
  });

  it("does not invent column headers in a headerless table with two row-header columns", () => {
    const parsed = parseEditableTables(fixture).tables[1]!;
    expect(parsed.valid).toBe(true);
    expect(parsed.headerRowCount).toBe(0);
    const output = exportedTable(parsed.source);
    expect(output.tHead).toBeNull();
    expect(headerTexts(output, cellWithText(output, "中文😊"))).toEqual(["North", "A"]);
    expect(headerTexts(output, cellWithText(output, "5"))).toEqual(["B", "South"]);
    expect(headerTexts(output, cellWithText(output, "B"))).toEqual(["North", "South"]);
    expect(output.querySelector('[scope="col"], [scope="colgroup"], [scope="rowgroup"]')).toBeNull();
    expect(output.querySelectorAll("td")).toHaveLength(5);
  });

  it("round-trips the native geometry through HTML import without depending on header IDs", () => {
    for (const parsed of parseEditableTables(fixture).tables) {
      const html = structuralTableToHtml(parsed, "test");
      const imported = structuralSourceFromClipboardHtml(html);
      expect(imported).not.toBeNull();
      const roundTrip = parseEditableTables(imported!).tables[0]!;
      expect(roundTrip.headerRowCount).toBe(parsed.headerRowCount);
      expect(roundTrip.rowHeaderColumnCount).toBe(parsed.rowHeaderColumnCount);
      expect(roundTrip.rows.map((row) => row.cells.map((cell) => [cell.content, cell.rowSpan, cell.columnSpan, cell.covered])))
        .toEqual(parsed.rows.map((row) => row.cells.map((cell) => [cell.content, cell.rowSpan, cell.columnSpan, cell.covered])));
    }
  });

  it("requires a safe ID namespace and preserves invalid-table refusal", () => {
    const parsed = parseEditableTables(fixture).tables[0]!;
    expect(() => structuralTableToHtml(parsed, 'bad" id')).toThrow("Invalid HTML header ID prefix");
    expect(() => structuralTableToHtml({ ...parsed, valid: false }, "test")).toThrow("Cannot export an invalid");
  });
});
