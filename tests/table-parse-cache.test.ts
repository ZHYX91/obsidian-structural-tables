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
  it("reuses the cache for ordinary CJK prose punctuation", () => {
    const chinese = "这是普通正文，包含中文标点。真的吗？\n\n| A | < |\n| --- | --- |\n| x | y |";
    const state = EditorState.create({ doc: chinese });
    const from = chinese.indexOf("普通");
    const transaction = state.update({ changes: { from, to: from + 2, insert: "一般" } });
    expect(mapTablesThroughProseEdit(parseEditableTables(chinese).tables, transaction))
      .toEqual(parseEditableTables(transaction.state.doc.toString()).tables);
  });
  it.each(["\n", "|", "---", "> ", "```", ":", "", "    code"])("reparses potential structure %j", (insert) => {
    const state = EditorState.create({ doc: source });
    const transaction = state.update({ changes: { from: 0, to: 17, insert } });
    expect(mapTablesThroughProseEdit(parseEditableTables(source).tables, transaction)).toBeNull();
  });
  it.each(["1. item", "1) item"])("does not reuse cached tables across ordered-list prose: %s", (line) => {
    const state = EditorState.create({ doc: source });
    const transaction = state.update({ changes: { from: 0, to: 17, insert: line } });
    expect(mapTablesThroughProseEdit(parseEditableTables(source).tables, transaction)).toBeNull();
  });
  it("reparses cell edits and missing caches", () => {
    const state = EditorState.create({ doc: source });
    const transaction = state.update({ changes: { from: source.indexOf("x"), insert: "more" } });
    expect(mapTablesThroughProseEdit(parseEditableTables(source).tables, transaction)).toBeNull();
    expect(mapTablesThroughProseEdit(null, transaction)).toBeNull();
  });
});
