import { describe, expect, it } from "vitest";

import { parseEditableTables } from "../src/core/parser";
import { tableCellSourceOffset } from "../src/editor/table-source-binding";

describe("tableCellSourceOffset", () => {
  it("maps a visible cell to its source content without changing the document", () => {
    const source = [
      "Before",
      "",
      "| Region | Sales | < |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
      "",
      "After",
    ].join("\n");
    const table = parseEditableTables(source).tables[0]!;
    const offset = tableCellSourceOffset(source, table, { row: 1, column: 1 });
    expect(offset).not.toBeNull();
    expect(source.slice(offset!, offset! + 2)).toBe("10");
  });

  it("maps native GFM source coordinates across an unescaped pipe in backticks", () => {
    const source = "| A | B | C |\n| --- | --- | --- |\n| `part|two` | 7 |";
    const table = parseEditableTables(source).tables[0]!;
    expect(tableCellSourceOffset(source, table, { row: 1, column: 1 })).toBe(source.indexOf("two"));
    expect(tableCellSourceOffset(source, table, { row: 1, column: 2 })).toBe(source.indexOf("7"));
  });

  it("maps a covered merge slot to the anchor cell", () => {
    const source = [
      "| Region | Sales | < |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
    ].join("\n");
    const table = parseEditableTables(source).tables[0]!;
    const anchor = tableCellSourceOffset(source, table, { row: 0, column: 1 });
    const covered = tableCellSourceOffset(source, table, { row: 0, column: 2 });
    expect(covered).toBe(anchor);
    expect(source.slice(anchor!, anchor! + 5)).toBe("Sales");
  });

  it("maps a GFM-padded missing cell to a stable position inside the owning row", () => {
    const source = [
      "| A | B | C |",
      "| --- | --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const table = parseEditableTables(source).tables[0]!;
    const offset = tableCellSourceOffset(source, table, { row: 1, column: 2 });
    expect(offset).not.toBeNull();
    expect(offset!).toBeLessThan(table.range.to);
    expect(source.slice(0, offset! + 1)).toContain("| 1 | 2 |");
  });

  it("preserves container prefixes when locating nested table source", () => {
    const source = [
      "> Intro",
      "> | Region | Sales | < |",
      "> | --- | --- | --- |",
      "> | North | 10 | 12 |",
    ].join("\n");
    const table = parseEditableTables(source).tables[0]!;
    const offset = tableCellSourceOffset(source, table, { row: 1, column: 0 });
    expect(offset).not.toBeNull();
    expect(source.slice(offset!, offset! + 5)).toBe("North");
  });
});

it("maps a separator-free GFM body row and its padded cell across quote spacing", () => {
  const source = "> | Name | Qty |\n> | --- | --- |\n>Bob\n> | Carol | 3 |";
  const table = parseEditableTables(source).tables[0]!;
  expect(tableCellSourceOffset(source, table, { row: 1, column: 0 })).toBe(source.indexOf("Bob"));
  expect(tableCellSourceOffset(source, table, { row: 1, column: 1 })).toBe(source.indexOf("Bob") + 2);
});
