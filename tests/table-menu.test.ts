import type { Editor, Menu } from "obsidian";
import { describe, expect, it } from "vitest";

import type { Translate } from "../src/config/i18n";
import { parseEditableTables, parseStructuralTables } from "../src/core/parser";
import { addBasePromotionMenuItem, addSelectionMenuItems, hasSelectionMenuItems, type TableOperation, type TableOperationIntent } from "../src/editor/table-menu";
import { selectedStructuralTableCells, structuralTableSelectionFromBounds } from "../src/editor/table-selection";
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

  it("offers explicit column-header removal when the complete header region is selected", () => {
    const table = parseEditableTables("| Name | Age |\n| --- | --- |\n| Alice | 20 |").tables[0]!;
    const selection = structuralTableSelectionFromBounds(table, { row: 0, column: 0 }, { row: 0, column: 1 })!;
    const menu = new MockMenu();
    const operations: TableOperation[] = [];
    addSelectionMenuItems(
      menu as unknown as Menu,
      t,
      selection,
      (operation) => { operations.push(operation); },
    );
    expect(menu.items.map((item) => item.title)).toContain("menu.removeHeaderRows");
    expect(menu.items.map((item) => item.title)).not.toContain("menu.setHeaderRows");
    const remove = menu.items.find((item) => item.title === "menu.removeHeaderRows");
    remove?.callback?.();
    expect(operations).toHaveLength(1);
    expect(operations[0]?.(table)).toMatchObject({ changed: true, code: "header-rows-set" });
  });

  it("hides the current row-header count but retains removal and a different count", () => {
    const table = parseStructuralTables("| Region | Name | Qty |\n| --- || --- | --- |\n| West | A | 2 |").tables[0]!;
    const selection = structuralTableSelectionFromBounds(table, { row: 0, column: 0 }, { row: 1, column: 0 })!;
    const menu = new MockMenu();
    const operations: TableOperation[] = [];
    addSelectionMenuItems(menu as unknown as Menu, t, selection, (operation) => { operations.push(operation); });
    expect(menu.items.some((item) => item.title === "menu.setRowHeaderColumns")).toBe(false);
    const remove = menu.items.find((item) => item.title === "menu.removeRowHeaders");
    expect(remove).toBeDefined();
    remove?.callback?.();
    const removed = parseEditableTables(operations[0]!(table).source).tables[0]!;
    expect(removed.rowHeaderColumnCount).toBe(0);
    expect(removed.rows.map((row) => row.cells.map((cell) => cell.content)))
      .toEqual(table.rows.map((row) => row.cells.map((cell) => cell.content)));

    const wider = structuralTableSelectionFromBounds(table, { row: 0, column: 0 }, { row: 1, column: 1 })!;
    const widerMenu = new MockMenu();
    addSelectionMenuItems(widerMenu as unknown as Menu, t, wider, (operation) => { operations.push(operation); });
    widerMenu.items.find((item) => item.title === "menu.setRowHeaderColumns")?.callback?.();
    expect(operations).toHaveLength(2);
    expect(parseEditableTables(operations[1]!(table).source).tables[0]!.rowHeaderColumnCount).toBe(2);
  });

  it("offers a changed multi-row header count while omitting the identical count", () => {
    const table = parseStructuralTables("| Group | Values |\n| Name | Qty |\n| --- || --- |\n| A | 2 |").tables[0]!;
    expect(table.headerRowCount).toBe(2);
    const same = structuralTableSelectionFromBounds(table, { row: 0, column: 0 }, { row: 1, column: 1 })!;
    const menu = new MockMenu();
    addSelectionMenuItems(menu as unknown as Menu, t, same, () => {});
    expect(menu.items.some((item) => item.title === "menu.setHeaderRows")).toBe(false);
    expect(menu.items.some((item) => item.title === "menu.removeHeaderRows")).toBe(true);

    const fewer = structuralTableSelectionFromBounds(table, { row: 0, column: 0 }, { row: 0, column: 1 })!;
    const fewerMenu = new MockMenu();
    const operations: TableOperation[] = [];
    addSelectionMenuItems(fewerMenu as unknown as Menu, t, fewer, (operation) => { operations.push(operation); });
    fewerMenu.items.find((item) => item.title === "menu.setHeaderRows")?.callback?.();
    expect(operations).toHaveLength(1);
    expect(parseEditableTables(operations[0]!(table).source).tables[0]!.headerRowCount).toBe(1);
  });

  it.each([
    ["---", "---", "menu.alignDefault"],
    [":---", ":---", "menu.alignLeft"],
    [":---:", ":---:", "menu.alignCenter"],
    ["---:", "---:", "menu.alignRight"],
    [":---", ":---:", null],
  ] as const)("checks only a uniform selected-column alignment (%s / %s)", (first, second, checked) => {
    const table = parseStructuralTables(`| Region | A | B | Keep |\n| --- || ${first} | ${second} | :---: |\n| West | 1 | 2 | 3 |`).tables[0]!;
    const selection = structuralTableSelectionFromBounds(table, { row: 1, column: 1 }, { row: 1, column: 2 })!;
    const menu = new MockMenu();
    const operations: TableOperation[] = [];
    addSelectionMenuItems(menu as unknown as Menu, t, selection, (operation) => { operations.push(operation); });
    const alignmentItems = menu.items.filter((item) => item.section === "structural-tables-alignment");
    expect(alignmentItems).toHaveLength(4);
    expect(alignmentItems.filter((item) => item.checked).map((item) => item.title)).toEqual(checked === null ? [] : [checked]);
    alignmentItems.find((item) => item.title === "menu.alignRight")?.callback?.();
    expect(operations).toHaveLength(1);
    const aligned = parseEditableTables(operations[0]!(table).source).tables[0]!;
    expect(aligned.alignments).toEqual(["default", "right", "right", "center"]);
    expect(aligned.rows.map((row) => row.cells.map((cell) => cell.content)))
      .toEqual(table.rows.map((row) => row.cells.map((cell) => cell.content)));
  });

  it("contributes only bootstrap actions to an ordinary multi-cell selection", () => {
    const table = parseEditableTables("| A | B |\n| --- | --- |\n| 1 |  |").tables[0]!;
    const selection = structuralTableSelectionFromBounds(table, { row: 1, column: 0 }, { row: 1, column: 1 })!;
    const menu = new MockMenu();
    addSelectionMenuItems(menu as unknown as Menu, t, selection, () => {});
    expect(menu.items.map((item) => item.title)).toEqual(["menu.mergeSelection"]);
  });

  it("offers Split instead of Merge for the complete closure of one merged owner", () => {
    const table = parseStructuralTables("| H1 | H2 | H3 |\n| --- | --- | --- |\n| Keep | M | < |\n| Keep2 | ^ | < |").tables[0]!;
    const selection = structuralTableSelectionFromBounds(table, { row: 1, column: 1 }, { row: 1, column: 1 })!;
    expect(selection.cells).toHaveLength(4);
    const menu = new MockMenu();
    const operations: TableOperation[] = [];
    addSelectionMenuItems(menu as unknown as Menu, t, selection, operation => { operations.push(operation); }, { fullEditor: false });
    expect(hasSelectionMenuItems(selection, { fullEditor: false })).toBe(true);
    expect(menu.items.map(item => item.title)).toEqual(["menu.splitCell"]);
    menu.items[0]?.callback?.();
    const result = operations[0]!(table);
    expect(result).toMatchObject({ changed: true, code: "split" });
    expect(parseEditableTables(result.source).tables[0]!.rows.slice(1).map(row => row.cells.map(cell => cell.content)))
      .toEqual([["Keep", "M", ""], ["Keep2", "", ""]]);
  });

  it("offers guarded Merge instead of Split when the selection contains distinct owners", () => {
    const table = parseStructuralTables("| H1 | H2 | H3 |\n| --- | --- | --- |\n| Keep | M | < |\n| Keep2 | ^ | < |").tables[0]!;
    const selection = structuralTableSelectionFromBounds(table, { row: 1, column: 0 }, { row: 2, column: 2 })!;
    const menu = new MockMenu();
    const operations: TableOperation[] = [];
    addSelectionMenuItems(menu as unknown as Menu, t, selection, operation => { operations.push(operation); }, { fullEditor: false });
    expect(menu.items.map(item => item.title)).toEqual(["menu.mergeSelection"]);
    menu.items[0]?.callback?.();
    expect(operations[0]!(table)).toMatchObject({ changed: false, code: "content-would-be-lost", source: table.source });
  });

  it("resolves a legacy source selection containing only covered slots to its one owner", () => {
    const source = "| H1 | H2 | H3 |\n| --- | --- | --- |\n| Keep | M | < |\n| Keep2 | ^ | < |";
    const lines = source.split("\n");
    const coveredLine = lines[3]!;
    const editor = {
      getLine: (line: number) => lines[line] ?? "",
      getValue: () => source,
      listSelections: () => [{
        anchor: { line: 3, ch: coveredLine.indexOf("^") },
        head: { line: 3, ch: coveredLine.indexOf("<") + 1 },
      }],
    } as unknown as Editor;
    const selection = selectedStructuralTableCells(editor)!;
    expect(selection.cells).toHaveLength(2);
    expect(selection.cells.every(cell => cell.covered)).toBe(true);
    const menu = new MockMenu();
    const operations: TableOperation[] = [];
    addSelectionMenuItems(menu as unknown as Menu, t, selection, operation => { operations.push(operation); }, { fullEditor: false });
    expect(menu.items.map(item => item.title)).toEqual(["menu.splitCell"]);
    menu.items[0]?.callback?.();
    expect(operations[0]!(selection.table)).toMatchObject({ changed: true, code: "split" });
  });

  it("keeps guarded shared deletion while takeover menus expose explicit destructive intents", () => {
    const table = parseEditableTables("| A | B |\n| --- | --- |\n| 1 | 2 |").tables[0]!;
    const selection = structuralTableSelectionFromBounds(table, { row: 1, column: 0 }, { row: 1, column: 1 })!;

    const guardedMenu = new MockMenu();
    const guarded: TableOperation[] = [];
    addSelectionMenuItems(
      guardedMenu as unknown as Menu,
      t,
      selection,
      (operation) => { guarded.push(operation); },
      { fullEditor: true },
    );
    expect(guardedMenu.items.map((item) => item.title)).not.toContain("menu.clearCells");
    expect(guardedMenu.items.map((item) => item.title)).not.toContain("menu.deleteTable");
    guardedMenu.items.find((item) => item.title === "menu.deleteRows")?.callback?.();
    expect(guarded[guarded.length - 1]?.(table)).toMatchObject({ changed: false, code: "content-would-be-lost" });

    const explicitMenu = new MockMenu();
    const explicit: Array<{ operation: TableOperation; intent: TableOperationIntent | undefined }> = [];
    addSelectionMenuItems(
      explicitMenu as unknown as Menu,
      t,
      selection,
      (operation, intent) => { explicit.push({ operation, intent }); },
      { fullEditor: true, explicitRemoval: true },
    );
    expect(explicitMenu.items.map((item) => item.title)).toEqual(expect.arrayContaining([
      "menu.clearCells",
      "menu.deleteRows",
      "menu.deleteColumns",
      "menu.deleteTable",
    ]));

    explicitMenu.items.find((item) => item.title === "menu.clearCells")?.callback?.();
    expect(explicit[explicit.length - 1]?.intent).toBe("owned-grid");
    expect(explicit[explicit.length - 1]?.operation(table)).toMatchObject({ changed: true, code: "cells-cleared" });

    explicitMenu.items.find((item) => item.title === "menu.deleteRows")?.callback?.();
    expect(explicit[explicit.length - 1]?.intent).toBe("owned-grid");
    expect(explicit[explicit.length - 1]?.operation(table)).toMatchObject({ changed: true, code: "rows-deleted" });

    explicitMenu.items.find((item) => item.title === "menu.deleteTable")?.callback?.();
    expect(explicit[explicit.length - 1]?.operation(table)).toMatchObject({ changed: true, code: "table-deleted", source: "" });
  });

  it("can expose the full editor for an explicitly owned ordinary table", () => {
    const table = parseEditableTables("| A | B |\n| --- | --- |\n| 1 | 2 |").tables[0]!;
    const selection = structuralTableSelectionFromBounds(table, { row: 1, column: 0 }, { row: 1, column: 0 })!;
    const menu = new MockMenu();
    const options = { fullEditor: true } as const;
    expect(hasSelectionMenuItems(selection, options)).toBe(true);
    addSelectionMenuItems(menu as unknown as Menu, t, selection, () => {}, options);
    expect(menu.items.map((item) => item.title)).toContain("menu.insertRowAbove");
    expect(menu.items.map((item) => item.title)).toContain("menu.deleteColumns");
  });

  it("distinguishes direct Base upgrades from structural expansion", () => {
    const ordinary = parseEditableTables("| A | B |\n| --- | --- |\n| 1 | 2 |").tables[0]!;
    const structural = parseStructuralTables("| A | B |\n| --- || --- |\n| 1 | 2 |").tables[0]!;
    const menu = new MockMenu();
    let calls = 0;
    addBasePromotionMenuItem(menu as unknown as Menu, t, ordinary, () => { calls += 1; });
    addBasePromotionMenuItem(menu as unknown as Menu, t, structural, () => { calls += 1; });
    expect(menu.items.map((item) => item.title)).toEqual([
      "menu.promoteBase",
      "menu.flattenAndPromoteBase",
    ]);
    menu.items.forEach((item) => item.callback?.());
    expect(calls).toBe(2);
  });
});
