import { EditorState } from "@codemirror/state";
import MarkdownIt from "markdown-it";
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
    "# Heading", "***", "___", "=", "--", "+", "*", "1.", "1)", "+   ", "[label", "label]",
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

  it("keeps unrelated prose reusable after a reference paragraph ends", () => {
    const start = EditorState.create({ doc: `[link]: /url\n  "title"\n\n中文，说明。\n\n| A | B |\n| --- | --- |\n| 1 | 2 |` });
    const tables = parseEditableTables(start.doc.toString()).tables;
    const from = start.doc.toString().indexOf("，");
    const transaction = start.update({ changes: { from, to: from + 1, insert: "；" } });
    expect(mapTablesThroughProseEdit(tables, transaction)).toEqual(parseEditableTables(transaction.state.doc.toString()).tables);
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

  it.each([
    { name: "escaped-tab reference destination", prefix: "[link]:\n", initial: "  a\\\tb", suffix: "\n<span>\n" + table + "\n</span>", edits: ["  a\\ b", "  a\\\tb"] },
    { name: "reference destination", prefix: "[link]:\n", initial: "  url", suffix: "\n<span>\n" + table + "\n</span>", edits: ["  url more", "  url"] },
    { name: "reference title", prefix: "[link]: /url\n", initial: "  \"title\"", suffix: "\n<span>\n" + table + "\n</span>", edits: ["  \"title", "  \"title\""] },
    { name: "multiline reference title", prefix: "[link]: /url \"first\n", initial: "  last\"", suffix: "\n<span>\n" + table + "\n</span>", edits: ["  last", "  last\""] },
    { name: "multiline label", prefix: "[first\n", initial: "last]: /url", suffix: "\n<span>\n" + table + "\n</span>", edits: ["last] /url", "last]: /url"] },
    ...["+", "*", "1.", "1)"].map((marker) => {
      const indent = " ".repeat(marker.length + 1);
      return { name: "empty list " + marker, prefix: "", initial: marker,
        suffix: "\n" + indent + "  ```\n" + table.split("\n").map((line) => indent + line).join("\n") + "\n" + indent + "  ```",
        edits: ["text", marker] };
    }),
  ])("invalidates successive $name ownership changes while preserving its adjacent real table", ({ prefix, initial, suffix, edits }) => {
    const real = "| REAL | B |\n| --- | --- |\n| keep | safe |";
    let state = EditorState.create({ doc: prefix + initial + suffix + "\n\n" + real });
    let cached = parseEditableTables(state.doc.toString()).tables;
    expect(cached).toHaveLength(1);
    for (const [index, insert] of edits.entries()) {
      const line = state.doc.lineAt(prefix.length);
      const transaction = state.update({ changes: { from: line.from, to: line.to, insert } });
      const complete = parseEditableTables(transaction.state.doc.toString()).tables;
      expect(mapTablesThroughProseEdit(cached, transaction)).toBeNull();
      cached = parseEditableTables(transaction.state.doc.toString()).tables;
      expect(cached).toEqual(complete);
      expect(cached).toHaveLength(index % 2 === 0 ? 2 : 1);
      expect(new MarkdownIt({ html: true }).parse(transaction.state.doc.toString(), {})
        .filter((token) => token.type === "table_open")).toHaveLength(cached.length);
      expect(cached[cached.length - 1]?.source).toBe(real);
      state = transaction.state;
    }
  });

});
