// @vitest-environment happy-dom

import { redo, undo } from "@codemirror/commands";
import type { Editor } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { structuralTableToDelimited } from "../src/core/interchange";
import { parseEditableTables } from "../src/core/parser";
import { removeTable, transposeTable } from "../src/core/operations";
import { validateTableOperationInDocument } from "../src/core/table-operation-document";
import { tableCommandEditor } from "./helpers/table-command-editor";
import type { StructuralTable } from "../src/core/model";
import { positionAfterReplacement, replaceTableSource } from "../src/editor/table-replacement";

describe("table source replacement", () => {
  it.each([
    ["one line", "abc", { line: 4, ch: 5 }],
    ["LF", "abc\ndef", { line: 5, ch: 3 }],
    ["CRLF", "abc\r\ndef", { line: 5, ch: 3 }],
    ["CR", "abc\rdef", { line: 5, ch: 3 }],
  ])("places the cursor after a %s replacement", (_name, source, expected) => {
    expect(positionAfterReplacement({ line: 4, ch: 2 }, source)).toEqual(expected);
  });

  it("replaces the exact table range and moves the cursor to the replacement end", () => {
    const from = { line: 2, ch: 0 };
    const to = { line: 4, ch: 7 };
    const replaceRange = vi.fn();
    const setCursor = vi.fn();
    const editor = {
      offsetToPos: vi.fn((offset: number) => offset === 10 ? from : to),
      replaceRange,
      setCursor,
    } as unknown as Editor;
    const table = { range: { from: 10, to: 42 } } as StructuralTable;
    const source = "| A |\r\n| --- |";

    replaceTableSource(editor, table, source);

    expect(replaceRange).toHaveBeenCalledWith(source, from, to);
    expect(setCursor).toHaveBeenCalledWith({ line: 3, ch: 7 });
  });
});

describe("whole-table commands with a separator-free GFM body row", () => {
  const original = "| Name | Qty |\n| --- | --- |\n| Alice | 1 |\nBob\n| Carol | 3 |";
  const nextBlock = "\n# Next section\nUnrelated text";
  it.each(["transpose", "delete"] as const)("copies every record and can undo the complete %s", (operation) => {
    const source = original + nextBlock;
    const f = tableCommandEditor(source);
    try {
      const table = parseEditableTables(source).tables[0]!;
      expect(structuralTableToDelimited(table, ",")).toBe("Name,Qty\nAlice,1\nBob,\nCarol,3");
      const plan = validateTableOperationInDocument(source, table,
        operation === "transpose" ? transposeTable(table) : removeTable(table));
      expect(plan.changed).toBe(true);
      replaceTableSource(f.editor, table, plan.source);
      expect(f.source()).toBe(plan.source + nextBlock);
      if (operation === "delete") expect(plan.source).toBe("");
      else {
        const rows = parseEditableTables(f.source()).tables[0]!.rows;
        expect(rows.map(row => row.cells.map(cell => cell.content))).toEqual([
          ["Name", "Alice", "Bob", "Carol"], ["Qty", "1", "", "3"],
        ]);
      }
      expect(undo(f.cm)).toBe(true);
      expect(f.source()).toBe(source);
      expect(redo(f.cm)).toBe(true);
      expect(f.source()).toBe(plan.source + nextBlock);
    } finally { f.destroy(); }
  });
});
