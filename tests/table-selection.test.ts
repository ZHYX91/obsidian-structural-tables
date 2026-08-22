import type { Editor, EditorSelection } from "obsidian";
import { describe, expect, it } from "vitest";

import { selectedStructuralTableCells } from "../src/editor/table-selection";

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
});
