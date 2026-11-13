import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { editCellContent, removeTable, transposeTable } from "../src/core/operations";
import { parseEditableTables } from "../src/core/parser";
import { validateTableOperationInDocument } from "../src/core/table-operation-document";
import { reparseUnchangedTable, TableDocumentSnapshot } from "../src/core/table-snapshot";

const fake = "| Fake | < |\n| --- | --- |\n| literal | KEEP |";
const real = "| Real | < |\n| --- | --- |\n| editable | value |";
const native = new MarkdownIt({ html: true });
const containers = [
  { name: "list quote", opening: "- > ", continuation: "  > ", outside: "  " },
  { name: "ordered list quote", opening: "12. > ", continuation: "    > ", outside: "    " },
  { name: "nested lists", opening: "- outer\n  - > ", continuation: "    > ", outside: "    " },
  { name: "quoted list quote", opening: "> - > ", continuation: ">   > ", outside: ">   " },
  { name: "alternating lists and quotes", opening: "- > - > ", continuation: "  >   > ", outside: "  >   " },
  { name: "tab-indented list quote", opening: "-\t>\t", continuation: "\t>\t", outside: "\t" },
] as const;
const htmlBlocks = [
  ["<pre>", "</pre>"], ["<script>", "</script>"], ["<style>", "</style>"], ["<textarea>", "</textarea>"],
  ["<div>", "</div>"], ["<span>", "</span>"], ["<?instruction", "?>"],
  ["<!DOCTYPE", ">"], ["<![CDATA[", "]]>"], ["<!--", "-->"],
] as const;
const prefixed = (source: string, prefix: string): string => source.split("\n").map((line) => prefix + line).join("\n");
const endings = ["\n", "\r\n", "\r"] as const;

describe("protected HTML in alternating Markdown containers", () => {
  it.each([
    { name: "quote inside list", head: "- item\n  > quote", prefix: "    " },
    { name: "list after exited fence", head: "- > ```\n> - child", prefix: "> " },
  ].flatMap((entry) => [false, true].flatMap((structural) =>
    endings.map((ending) => ({ ...entry, structural, ending })))))(
    "keeps lazy paragraph text protected in $name (structural=$structural, $ending)", (entry) => {
      const content = prefixed(entry.structural ? fake : fake.replace("<", "B"), entry.prefix);
      const note = (entry.head + "\n" + content + "\n\n" + real).replace(/\n/gu, entry.ending);
      expect(native.parse(note, {}).filter((token) => token.type === "table_open")).toHaveLength(1);
      expect(parseEditableTables(note).tables.map((table) => table.source))
        .toEqual([real.replace(/\n/gu, entry.ending)]);

      const separated = (entry.head + "\n" + entry.prefix.trimEnd() + "\n" + content
        + "\n\n" + real).replace(/\n/gu, entry.ending);
      expect(native.parse(separated, {}).filter((token) => token.type === "table_open")).toHaveLength(2);
      expect(parseEditableTables(separated).tables.map((table) => table.source)).toEqual([
        content.replace(/\n/gu, entry.ending), real.replace(/\n/gu, entry.ending),
      ]);
    },
  );

  it.each(endings)("rejects a stale target newly owned by a lazy quote paragraph with %s endings", (ending) => {
    const initial = ("- item\n  >      \n" + prefixed(fake, "    ") + "\n\n" + real).replace(/\n/gu, ending);
    const table = parseEditableTables(initial).tables[0]!;
    const updated = initial.replace(">      ", "> quote");
    expect(updated.slice(table.range.from, table.range.to)).toBe(table.source);
    const snapshot = new TableDocumentSnapshot(updated);
    expect(reparseUnchangedTable(snapshot, table)).toBeNull();
    for (const operation of [editCellContent(table, 1, 0, "MUTATED"), removeTable(table), transposeTable(table)]) {
      expect(operation.changed).toBe(true);
      for (const document of [updated, snapshot]) {
        expect(validateTableOperationInDocument(document, table, operation)).toMatchObject({ changed: false, source: table.source });
      }
    }
  });

  it.each(containers.flatMap((container) => htmlBlocks.flatMap(([opening, closing]) =>
    endings.map((ending) => ({ ...container, tag: opening, closing, ending })))))(
    "keeps $tag literal in $name with $ending endings and preserves the following table", (entry) => {
      const literal = entry.opening + entry.tag + "\n" + prefixed(fake, entry.continuation)
        + "\n" + entry.continuation + entry.closing;
      const note = (literal + "\n\n" + real).replace(/\n/gu, entry.ending);
      const tokens = native.parse(note, {});
      expect(tokens.some((token) => token.type === "html_block" && token.content.includes("| Fake | < |"))).toBe(true);
      expect(tokens.filter((token) => token.type === "table_open")).toHaveLength(1);
      const tables = parseEditableTables(note).tables;
      expect(tables.map((table) => table.source)).toEqual([real.replace(/\n/gu, entry.ending)]);
      const table = tables[0]!;
      expect(table.valid).toBe(true);
      expect(note.slice(table.range.from, table.range.to)).toBe(table.source);
      const edit = validateTableOperationInDocument(note, table, editCellContent(table, 1, 0, "changed"));
      expect(edit.changed).toBe(true);
      const updated = note.slice(0, table.range.from) + edit.source + note.slice(table.range.to);
      expect(updated.slice(0, table.range.from)).toBe((literal + "\n\n").replace(/\n/gu, entry.ending));
      expect(parseEditableTables(updated).tables[0]?.rows[1]?.cells[0]?.content).toBe("changed");
    },
  );

  it.each(containers.flatMap((container) => ["<pre>", "<div>", "<?instruction", "<![CDATA["].flatMap((tag) =>
    endings.map((ending) => ({ ...container, tag, ending })))))(
    "ends unclosed $tag protection when $name exits with $ending endings", (entry) => {
      const note = (entry.opening + entry.tag + "\n" + prefixed(fake, entry.continuation)
        + "\n" + prefixed(real, entry.outside)).replace(/\n/gu, entry.ending);
      expect(native.parse(note, {}).filter((token) => token.type === "table_open")).toHaveLength(1);
      expect(parseEditableTables(note).tables.map((table) => table.source))
        .toEqual([prefixed(real, entry.outside).replace(/\n/gu, entry.ending)]);
    },
  );

  it.each(["<pre>", "<div>", "<?instruction", "<![CDATA["])(
    "ends %s at a new quote outside the old list even when quote depth is unchanged", (tag) => {
      const note = "- > " + tag + "\n" + prefixed(fake, "  > ") + "\n" + prefixed(real, "> ");
      expect(native.parse(note, {}).filter((token) => token.type === "table_open")).toHaveLength(1);
      expect(parseEditableTables(note).tables.map((table) => table.source)).toEqual([prefixed(real, "> ")]);
    },
  );

  it.each(containers)("does not let literal inner quotes or lists close HTML in $name", (entry) => {
    const literal = entry.opening + "<pre>\n" + entry.continuation + "> - literal\n"
      + prefixed(fake, entry.continuation) + "\n" + entry.continuation + "</pre>";
    expect(parseEditableTables(literal + "\n\n" + real).tables.map((table) => table.source)).toEqual([real]);
  });

  it.each(containers.flatMap((container) => [
    { tag: "<pre>", close: "</pre>", needsBlank: false },
    { tag: "<span>", close: "</span>", needsBlank: true },
  ].map((block) => ({ ...container, ...block }))))(
    "resumes in the same $name after $tag ends", (entry) => {
      const literal = entry.opening + entry.tag + "\n" + prefixed(fake, entry.continuation)
        + "\n" + entry.continuation + entry.close;
      const separator = entry.needsBlank ? "\n" + entry.continuation.trimEnd() : "";
      const note = literal + separator + "\n" + prefixed(real, entry.continuation);
      expect(native.parse(note, {}).filter((token) => token.type === "table_open")).toHaveLength(1);
      expect(parseEditableTables(note).tables.map((table) => table.source)).toEqual([prefixed(real, entry.continuation)]);
    },
  );

  it.each(containers.flatMap((container) => ["```", "~~~"].map((fence) => ({ ...container, fence }))))(
    "keeps fenced examples protected through $name for $fence", (entry) => {
      const note = entry.opening + entry.fence + "md\n" + prefixed(fake, entry.continuation)
        + "\n" + entry.continuation + entry.fence + "\n\n" + real;
      expect(native.parse(note, {}).filter((token) => token.type === "fence")).toHaveLength(1);
      expect(parseEditableTables(note).tables.map((table) => table.source)).toEqual([real]);
    },
  );

  it.each(containers.flatMap((container) => [
    "Paragraph\n<span>", "text <div>", "<widget =broken>", "`<pre>`",
  ].map((content) => ({ ...container, content }))))(
    "keeps real tables after non-block $content in $name", (entry) => {
      const head = entry.opening + entry.content.replace(/\n/gu, "\n" + entry.continuation);
      const expected = prefixed(fake, entry.continuation);
      const note = head + "\n" + expected + "\n\n" + real;
      const tokens = native.parse(note, {});
      expect(tokens.filter((token) => token.type === "table_open")).toHaveLength(2);
      expect(tokens.some((token) => token.type === "html_block")).toBe(false);
      expect(parseEditableTables(note).tables.map((table) => table.source)).toEqual([expected, real]);
    },
  );

  it.each(containers.flatMap((container) => endings.map((ending) => ({ ...container, ending }))))(
    "refuses byte-identical stale table targets newly protected by HTML in $name with $ending endings", (entry) => {
      const initial = (entry.opening + "plain\n" + prefixed(fake, entry.continuation)
        + "\n" + entry.continuation + "</pre>\n\n" + real).replace(/\n/gu, entry.ending);
      const table = parseEditableTables(initial).tables[0]!;
      const protectedNote = initial.replace("plain", "<pre>");
      // The opening changes the container semantics, while every selected byte
      // and source offset remains identical. Byte checks alone are insufficient.
      expect(protectedNote.slice(table.range.from, table.range.to)).toBe(table.source);
      const snapshot = new TableDocumentSnapshot(protectedNote);
      expect(reparseUnchangedTable(snapshot, table)).toBeNull();
      for (const operation of [editCellContent(table, 1, 0, "MUTATED"), removeTable(table), transposeTable(table)]) {
        expect(operation.changed).toBe(true);
        for (const document of [protectedNote, snapshot]) {
          expect(validateTableOperationInDocument(document, table, operation)).toMatchObject({
            changed: false, source: table.source,
          });
        }
      }
      expect(snapshot.source).toBe(protectedNote);
      expect(snapshot.tables.map((candidate) => candidate.source)).toEqual([real.replace(/\n/gu, entry.ending)]);
    },
  );

  it.each(["", "> ", "> > "].flatMap((outer) => ["", " "].flatMap((indent) =>
    [false, true].flatMap((structural) => endings.map((ending) => ({ outer, indent, structural, ending }))))))(
    "does not restore an exited list after a new quote ($outer/$indent, structural=$structural, $ending)", (entry) => {
      const sourceTable = entry.structural ? fake : fake.replace("<", "B");
      const content = prefixed(sourceTable, "    ");
      const note = (prefixed("- item\n" + entry.indent + "> quote\n\n" + content, entry.outer)
        + "\n\n" + real).replace(/\n/gu, entry.ending);
      const tokens = native.parse(note, {});
      expect(tokens.filter((token) => token.type === "code_block")).toHaveLength(1);
      expect(tokens.filter((token) => token.type === "table_open")).toHaveLength(1);
      expect(parseEditableTables(note).tables.map((table) => table.source)).toEqual([real.replace(/\n/gu, entry.ending)]);

      // Two spaces keep the quote in the existing list. Its later indented
      // table must remain editable rather than becoming a code block.
      const continued = (prefixed("- item\n  > quote\n\n" + content, entry.outer)
        + "\n\n" + real).replace(/\n/gu, entry.ending);
      expect(native.parse(continued, {}).filter((token) => token.type === "table_open")).toHaveLength(2);
      expect(parseEditableTables(continued).tables.map((table) => table.source)).toEqual([
        prefixed(content, entry.outer).replace(/\n/gu, entry.ending), real.replace(/\n/gu, entry.ending),
      ]);
    },
  );

  it.each(["", "> ", "> > "].flatMap((outer) => endings.map((ending) => ({ outer, ending }))))(
    "refuses stale writes when a quote leaves the list and exposes indented code ($outer, $ending)", ({ outer, ending }) => {
      const initial = (prefixed("- item\n  > quote\n\n" + prefixed(fake, "    "), outer)
        + "\n\n" + real).replace(/\n/gu, ending);
      const table = parseEditableTables(initial).tables[0]!;
      const updated = initial.replace("  > quote", "> quote  ");
      expect(updated.slice(table.range.from, table.range.to)).toBe(table.source);
      const snapshot = new TableDocumentSnapshot(updated);
      expect(reparseUnchangedTable(snapshot, table)).toBeNull();
      for (const operation of [editCellContent(table, 1, 0, "MUTATED"), removeTable(table), transposeTable(table)]) {
        expect(operation.changed).toBe(true);
        for (const document of [updated, snapshot]) {
          expect(validateTableOperationInDocument(document, table, operation)).toMatchObject({
            changed: false, source: table.source,
          });
        }
      }
      expect(snapshot.source).toBe(updated);
      expect(snapshot.tables.map((candidate) => candidate.source)).toEqual([real.replace(/\n/gu, ending)]);
    },
  );
});
