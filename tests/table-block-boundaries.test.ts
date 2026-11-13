import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";

import { editCellContent } from "../src/core/operations";
import { parseEditableTables } from "../src/core/parser";
import { withSourcePrefix } from "../src/core/source-lines";
import { validateTableOperationInDocument } from "../src/core/table-operation-document";

const TABLE = "| A | < |\n| --- | --- |\n| x | y |";
const markdown = new MarkdownIt();

describe("table Markdown block boundaries", () => {
  it.each([
    "# Next | explanation", "###### Next | explanation", "#\tNext | explanation",
    "- Next | explanation", "+ Next | explanation", "* Next | explanation", "-\tNext | explanation",
    "1. Next | explanation", "2) Next | explanation", "000000001. Next | explanation",
  ])("ends the body before the independent block %j", (next) => {
    for (const tableSource of [TABLE, TABLE.replace("<", "B")]) {
      const source = `${tableSource}\n${next}`;
      const native = markdown.parse(source, {});
      expect(native.find((token) => token.type === "table_open")?.map).toEqual([0, 3]);
      expect(native.some((token) => ["heading_open", "bullet_list_open", "ordered_list_open"].includes(token.type))).toBe(true);
      const table = parseEditableTables(source).tables[0]!;
      expect(table.valid).toBe(true);
      expect(table.source).toBe(tableSource);
      expect(table.range).toEqual({ from: 0, to: tableSource.length });
    }
  });

  it.each(["# Before | explanation", "###### Before | explanation"])(
    "does not extend column headers across the preceding block %j", (before) => {
      const source = `${before}\n${TABLE}`;
      const table = parseEditableTables(source).tables[0]!;
      expect(table.source).toBe(TABLE);
      expect(table.headerRowCount).toBe(1);
      expect(table.range.from).toBe(before.length + 1);
    },
  );

  it.each(["- Before | explanation", "2. Before | explanation"])(
    "does not acquire a lazy list paragraph after %j", (before) => {
      const source = `${before}\n${TABLE}`;
      expect(markdown.parse(source, {}).some((token) => token.type === "table_open")).toBe(false);
      expect(parseEditableTables(source).tables).toEqual([]);
      const separated = `${before}\n\n${TABLE}`;
      expect(markdown.parse(separated, {}).filter((token) => token.type === "table_open")).toHaveLength(1);
      expect(parseEditableTables(separated).tables[0]?.source).toBe(TABLE);
    },
  );

  it.each(["# Header", "###### Header", "- Header", "+ Header", "* Header", "0. Header", "2) Header"])(
    "preserves GFM table precedence for the immediate header %j", (firstCell) => {
      const source = `${firstCell} | Value\n--- | ---\nx | y`;
      expect(markdown.parse(source, {}).find((token) => token.type === "table_open")?.map).toEqual([0, 3]);
      const table = parseEditableTables(source).tables[0]!;
      expect(table).toMatchObject({ valid: true, structural: false, headerRowCount: 1, source });
      expect(table.rows[0]?.cells[0]?.content).toBe(firstCell);
    },
  );

  it.each(["- Header", "+ Header", "* Header", "0. Header", "2) Header"])(
    "lets an immediate table header end an outer lazy paragraph: %j", (firstCell) => {
      for (const [head, prefix] of [["> plain\n", ""], ["- item\n  > quote\n", "    "]] as const) {
        const source = head + withSourcePrefix(`${firstCell} | Value\n--- | ---\nx | y`, prefix);
        const native = markdown.parse(source, {}).filter((token) => token.type === "table_open");
        expect(native).toHaveLength(1);
        const table = parseEditableTables(source).tables[0]!;
        expect(table).toMatchObject({ valid: true, structural: false, headerRowCount: 1 });
        expect(table.source).toBe(source.slice(head.length));
      }
    },
  );

  it("does not turn a mismatched heading into an invalid table header", () => {
    const before = "# Heading | with | pipes\n";
    const source = "| --- | --- |\n| x | y |";
    const table = parseEditableTables(before + source).tables[0]!;
    expect(table).toMatchObject({ valid: true, headerRowCount: 0, source });
    expect(table.range.from).toBe(before.length);
  });

  it("keeps a list-shaped delimiter outside table ownership", () => {
    const source = "A | B\n- | ---\nx | y";
    expect(markdown.parse(source, {}).some((token) => token.type === "table_open")).toBe(false);
    expect(parseEditableTables(source).tables).toEqual([]);
    for (const delimiter of ["-|-", "| - | - |", "--- | ---"]) {
      const valid = `A | B\n${delimiter}\nx | y`;
      expect(markdown.parse(valid, {}).some((token) => token.type === "table_open")).toBe(true);
      expect(parseEditableTables(valid).tables[0]).toMatchObject({ valid: true, source: valid });
    }
  });

  it.each([
    "#tag", "####### text", "-text", "+text", "1.text", "1234567890. text",
    "\\# text", "\\- text", "*emphasis*", "`# text`",
  ])("retains row text that is not a Markdown block starter: %j", (firstCell) => {
    const source = `${TABLE}\n${firstCell} | kept`;
    const table = parseEditableTables(source).tables[0]!;
    expect(table).toMatchObject({ valid: true, source });
    expect(table.rows[2]?.cells[0]?.content).toBe(firstCell);
  });

  it("keeps explicit pipe cells and unbordered multi-row column headers", () => {
    const source = "Group | <\nName | Value\n--- | ---\n| # literal | - literal |\n| 2. literal | * literal |";
    const table = parseEditableTables(source).tables[0]!;
    expect(table).toMatchObject({ valid: true, source, headerRowCount: 2 });
    expect(table.rows[0]?.cells[0]?.columnSpan).toBe(2);
    expect(table.rows[2]?.cells.map((cell) => cell.content)).toEqual(["# literal", "- literal"]);
    expect(table.rows[3]?.cells.map((cell) => cell.content)).toEqual(["2. literal", "* literal"]);
  });

  it.each(["\n", "\r\n", "\r"])("preserves adjacent blocks and exact container bytes through a cell edit for %j", (ending) => {
    for (const [context, prefix] of [["", ""], ["", "> "], ["> [!note]\n", "> "],
      ["- Outer\n  - Inner\n\n", "    "], ["- Item\n\n", "\t"]] as const) {
      const before = (context + prefix + "# Before | explanation\n").replace(/\n/gu, ending);
      const tableSource = withSourcePrefix(TABLE, prefix).replace(/\n/gu, ending);
      const after = ending + prefix + "- After | explanation";
      const source = before + tableSource + after;
      const table = parseEditableTables(source).tables[0]!;
      expect(table.source, source).toBe(tableSource);
      expect(table.sourcePrefix).toBe(prefix);
      const edit = validateTableOperationInDocument(source, table, editCellContent(table, 1, 1, "CHANGED"));
      expect(edit.changed).toBe(true);
      const updated = source.slice(0, table.range.from) + edit.source + source.slice(table.range.to);
      expect(updated.slice(0, table.range.from)).toBe(before);
      expect(updated.slice(table.range.from + edit.source.length)).toBe(after);
      expect(edit.source.split(ending)).toHaveLength(3);
      expect(parseEditableTables(updated).tables[0]?.rows[1]?.cells[1]?.content).toBe("CHANGED");
    }
  });
});
