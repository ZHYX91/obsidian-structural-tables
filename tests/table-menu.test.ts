import type { Menu } from "obsidian";
import { describe, expect, it } from "vitest";

import type { Translate } from "../src/config/i18n";
import { parseEditableTables, parseStructuralTables } from "../src/core/parser";
import { addSelectionMenuItems, hasSelectionMenuItems } from "../src/editor/table-menu";
import { structuralTableSelectionFromBounds } from "../src/editor/table-selection";
import { Menu as MockMenu } from "./mocks/obsidian";

const t: Translate = (key) => key;

describe("table menus", () => {
  it("leaves a single-cell ordinary table menu entirely native", () => {
    const table = parseEditableTables("| A | B |\n| --- | --- |\n| 1 | 2 |").tables[0]!;
    const selection = structuralTableSelectionFromBounds(table, { row: 1, column: 0 }, { row: 1, column: 0 })!;
    expect(table.structural).toBe(false);
    expect(hasSelectionMenuItems(selection)).toBe(false);
  });

  it("adds the full editing menu only for structural tables", () => {
    const table = parseStructuralTables("| A | B |\n| --- || --- |\n| 1 | 2 |").tables[0]!;
    const selection = structuralTableSelectionFromBounds(table, { row: 1, column: 0 }, { row: 1, column: 0 })!;
    const menu = new MockMenu();
    addSelectionMenuItems(menu as unknown as Menu, t, selection, () => {});
    expect(hasSelectionMenuItems(selection)).toBe(true);
    expect(menu.items.map((item) => item.title)).toContain("menu.insertRowAbove");
    expect(menu.items.map((item) => item.title)).toContain("menu.deleteColumns");
    expect(menu.items.map((item) => item.title)).toContain("menu.alignCenter");
  });

  it("contributes only bootstrap actions to an ordinary multi-cell selection", () => {
    const table = parseEditableTables("| A | B |\n| --- | --- |\n| 1 |  |").tables[0]!;
    const selection = structuralTableSelectionFromBounds(table, { row: 1, column: 0 }, { row: 1, column: 1 })!;
    const menu = new MockMenu();
    addSelectionMenuItems(menu as unknown as Menu, t, selection, () => {});
    expect(menu.items.map((item) => item.title)).toEqual(["menu.mergeSelection"]);
  });
});
