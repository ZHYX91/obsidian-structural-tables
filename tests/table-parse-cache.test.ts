import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { parseEditableTables } from "../src/core/parser";
import { mapTablesThroughProseEdit } from "../src/editor/table-parse-cache";

const source = "A plain paragraph\n\n| A | < |\n| --- | --- |\n| x | y |";
describe("prose edit cache", () => {
  it("matches a full parse after a paragraph edit shifts the table", () => {
    const state = EditorState.create({ doc: source });
    const transaction = state.update({ changes: { from: 2, to: 7, insert: "longer updated" } });
    expect(mapTablesThroughProseEdit(parseEditableTables(source).tables, transaction))
      .toEqual(parseEditableTables(transaction.state.doc.toString()).tables);
  });
  it.each(["\n", "|", "---", "> ", "```", ":", "%%", "<!--", "-->", "$$", "", "    code"])("reparses potential structure %j", (insert) => {
    const state = EditorState.create({ doc: source });
    const transaction = state.update({ changes: { from: 0, to: 17, insert } });
    expect(mapTablesThroughProseEdit(parseEditableTables(source).tables, transaction)).toBeNull();
  });
  it("reparses cell edits and missing caches", () => {
    const state = EditorState.create({ doc: source });
    const transaction = state.update({ changes: { from: source.indexOf("x"), insert: "more" } });
    expect(mapTablesThroughProseEdit(parseEditableTables(source).tables, transaction)).toBeNull();
    expect(mapTablesThroughProseEdit(null, transaction)).toBeNull();
  });
  it("reuses table snapshots across ordinary CJK punctuation edits", () => {
    const start = EditorState.create({ doc: `中文，说明。\n\n| A | B |\n| --- | --- |\n| 1 | 2 |` });
    const tables = parseEditableTables(start.doc.toString()).tables;
    const transaction = start.update({ changes: { from: 2, to: 3, insert: "；" } });

    expect(mapTablesThroughProseEdit(tables, transaction)).not.toBeNull();
  });

});
