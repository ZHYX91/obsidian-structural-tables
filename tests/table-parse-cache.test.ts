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
  it.each([
    "\n", "|", "---", "> ", "```", ":", "%%", "<!--", "-->", "$$", "$$x", "x$$", "", "    code",
    "<pre>", '<PRE class="literal">', "</pre>", "<script", "</SCRIPT>", "<style>", "</STYLE>",
    "<textarea>", "</TEXTAREA>",
    "<div>", "</details>", "<span>", "<?xml", "?>", "<![CDATA[", "]]>", "<!DOCTYPE", ">",
    "# Heading", "***", "___", "=", "--",
    "ordinary prose <pre> inline", "<prelude> is not a literal raw tag",
  ])("reparses potential structure %j", (insert) => {
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

  const table = "| A | < |\n| --- | --- |\n| x | y |";
  it.each([
    { name: "block HTML", prefix: "", suffix: "", edits: ["<div>", "text", "</details>", "text"] },
    { name: "standalone HTML", prefix: "", suffix: "", edits: ["<span>", "text"] },
    { name: "processing instruction", prefix: "", suffix: "", edits: ["<?xml", "text"] },
    { name: "CDATA", prefix: "", suffix: "", edits: ["<![CDATA[", "text"] },
    { name: "HTML declaration", prefix: "", suffix: "", edits: ["<!DOCTYPE", "text"] },
    { name: "declaration ending", prefix: "<!DOCTYPE\n", suffix: "", edits: [">", "text"] },
    { name: "processing instruction ending", prefix: "<?xml\n", suffix: "", edits: ["?>", "text"] },
    { name: "CDATA ending", prefix: "<![CDATA[\n", suffix: "", edits: ["]]>", "text"] },
    { name: "paragraph boundary", prefix: "", suffix: "\n<span>", edits: ["# Heading", "text", "***", "text", "___", "text"] },
    { name: "setext boundary", prefix: "Title\n", suffix: "\n<span>", edits: ["=", "text", "--", "text"] },
  ])("matches a complete parse through successive $name edits", ({ prefix, suffix, edits }) => {
    let state = EditorState.create({ doc: `${prefix}text${suffix}\n${table}` });
    let cached = parseEditableTables(state.doc.toString()).tables;
    for (const insert of edits) {
      const line = state.doc.lineAt(prefix.length);
      const transaction = state.update({ changes: { from: line.from, to: line.to, insert } });
      const complete = parseEditableTables(transaction.state.doc.toString()).tables;
      const mapped = mapTablesThroughProseEdit(cached, transaction);
      cached = [...(mapped ?? parseEditableTables(transaction.state.doc.toString()).tables)];
      expect(cached, `${prefix}${insert}${suffix}`).toEqual(complete);
      state = transaction.state;
    }
  });

});
