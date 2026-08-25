import type { Editor, EditorSelection } from "obsidian";
import { describe, expect, it } from "vitest";

import {
  selectedStructuralTableCells,
  structuralTableSelectionFromBounds,
} from "../src/editor/table-selection";
import { parseStructuralTables } from "../src/core/parser";

const source = "| Group | Value |\n| Name | Amount |\n| --- | --- |\n| A |  |\n|  |  |";

function editorWith(selections: EditorSelection[]): Editor {
  const lines = source.split("\n");
  return {
    getLine: (line: number) => lines[line] ?? "",
    getValue: () => source,
    listSelections: () => selections,
  } as unknown as Editor;
}

describe("selectedStructuralTableCells", () => {
  it("maps Obsidian-style multiple cell selections to a rectangle", () => {
    const selection = selectedStructuralTableCells(editorWith([
      { anchor: { line: 3, ch: 2 }, head: { line: 3, ch: 2 } },
      { anchor: { line: 3, ch: 6 }, head: { line: 3, ch: 6 } },
      { anchor: { line: 4, ch: 2 }, head: { line: 4, ch: 2 } },
      { anchor: { line: 4, ch: 6 }, head: { line: 4, ch: 6 } },
    ]));
    expect(selection).toMatchObject({
      rectangular: true,
      minRow: 2,
      maxRow: 3,
      minColumn: 0,
      maxColumn: 1,
    });
    expect(selection?.cells).toHaveLength(4);
  });

  it("maps a whole source-row range to every cell in that row", () => {
    const selection = selectedStructuralTableCells(editorWith([
      { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 19 } },
    ]));
    expect(selection).toMatchObject({ rectangular: true, minRow: 0, maxRow: 0, minColumn: 0, maxColumn: 1 });
  });

  it("maps one cell per semantic row to a whole-column selection", () => {
    const selection = selectedStructuralTableCells(editorWith([
      { anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 2 } },
      { anchor: { line: 1, ch: 2 }, head: { line: 1, ch: 2 } },
      { anchor: { line: 3, ch: 2 }, head: { line: 3, ch: 2 } },
      { anchor: { line: 4, ch: 2 }, head: { line: 4, ch: 2 } },
    ]));
    expect(selection).toMatchObject({ rectangular: true, minRow: 0, maxRow: 3, minColumn: 0, maxColumn: 0 });
  });

  it("marks a sparse selection as nonrectangular", () => {
    const selection = selectedStructuralTableCells(editorWith([
      { anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 2 } },
      { anchor: { line: 1, ch: 10 }, head: { line: 1, ch: 10 } },
    ]));
    expect(selection?.rectangular).toBe(false);
  });

  it("rejects selections that cross source lines or tables", () => {
    expect(selectedStructuralTableCells(editorWith([
      { anchor: { line: 0, ch: 2 }, head: { line: 1, ch: 2 } },
    ]))).toBeNull();
  });

  it("maps selections in an ordinary GFM table so an edit can bootstrap structural syntax", () => {
    const plain = "| A | B |\n| --- | --- |\n| 1 |  |";
    const lines = plain.split("\n");
    const editor = {
      getLine: (line: number) => lines[line] ?? "",
      getValue: () => plain,
      listSelections: () => [
        { anchor: { line: 2, ch: 2 }, head: { line: 2, ch: 2 } },
        { anchor: { line: 2, ch: 6 }, head: { line: 2, ch: 6 } },
      ],
    } as unknown as Editor;
    expect(selectedStructuralTableCells(editor)).toMatchObject({
      rectangular: true,
      minRow: 1,
      maxRow: 1,
      minColumn: 0,
      maxColumn: 1,
    });
  });

  it("expands a rendered-cell drag to include an existing merged cell in full", () => {
    const table = parseStructuralTables("| A | < | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |").tables[0]!;
    expect(structuralTableSelectionFromBounds(table, { row: 0, column: 0 }, { row: 1, column: 0 })).toMatchObject({
      rectangular: true,
      minRow: 0,
      maxRow: 1,
      minColumn: 0,
      maxColumn: 1,
    });
  });
});
