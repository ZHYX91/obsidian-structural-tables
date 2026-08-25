import type { Editor } from "obsidian";
import { describe, expect, it, vi } from "vitest";

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
