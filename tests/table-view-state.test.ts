import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import { structuralTableViewMode } from "../src/editor/table-view-state";

describe("structuralTableViewMode", () => {
  const structural = parseEditableTables([
    "| Region | Sales | < |",
    "| --- || --- | --- |",
    "| North | 10 | 12 |",
  ].join("\n")).tables[0]!;
  const ordinary = parseEditableTables([
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
  ].join("\n")).tables[0]!;

  it("keeps a valid owned table in presentation mode while selection is outside it", () => {
    expect(structuralTableViewMode(structural, DEFAULT_SETTINGS, [
      { from: structural.range.to, to: structural.range.to, empty: true },
    ], [])).toBe("presentation");
  });

  it("restores source while a selection intersects the table", () => {
    expect(structuralTableViewMode(structural, DEFAULT_SETTINGS, [
      { from: structural.range.from + 1, to: structural.range.from + 1, empty: true },
    ], [])).toBe("source");
    expect(structuralTableViewMode(structural, DEFAULT_SETTINGS, [
      { from: structural.range.from - 1, to: structural.range.from + 1, empty: false },
    ], [])).toBe("source");
  });

  it("leaves ordinary tables alone unless takeover is enabled", () => {
    expect(structuralTableViewMode(ordinary, DEFAULT_SETTINGS, [], [])).toBe("ignored");
    expect(structuralTableViewMode(
      ordinary,
      { ...DEFAULT_SETTINGS, takeOverOrdinaryTables: true },
      [],
      [],
    )).toBe("presentation");
  });

  it("leaves tables owned by a callout renderer alone", () => {
    expect(structuralTableViewMode(structural, DEFAULT_SETTINGS, [], [
      { from: structural.range.from, to: structural.range.to },
    ])).toBe("ignored");
  });

  it("routes owned invalid tables to diagnostics rather than presentation", () => {
    expect(structuralTableViewMode({ ...structural, valid: false }, DEFAULT_SETTINGS, [], []))
      .toBe("invalid");
  });
});
