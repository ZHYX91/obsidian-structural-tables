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

  it.each(["-", "+", "*", "1.", "1)"].flatMap((marker) => ["\n", "\n\n"].flatMap((separator) =>
    [false, true].map((structural) => ({ marker, separator, structural })))))(
    "retains sibling list ownership before a delimiter ($marker/$separator, structural=$structural)", ({ marker, separator, structural }) => {
      const source = `${marker} plain${separator}${marker} H | ${structural ? "<" : "V"}\n--- | ---\na | b`;
      expect(markdown.parse(source, {}).some((token) => token.type === "table_open")).toBe(false);
      expect(parseEditableTables(source).tables).toEqual([]);
      const other = marker === "-" ? "+" : "-";
      const changedMarker = `${marker} plain${separator}${other} H | V\n--- | ---\na | b`;
      expect(markdown.parse(changedMarker, {}).filter((token) => token.type === "table_open")).toHaveLength(1);
      expect(parseEditableTables(changedMarker).tables[0]?.valid).toBe(true);
    },
  );

  it.each([" ", "  ", "   "])("keeps an outdented sibling inside the existing list after %j", (indent) => {
    for (const prefix of ["", "> "]) {
      for (const ending of ["\n", "\r\n", "\r"]) {
        const source = withSourcePrefix(`${indent}- plain\n- H | <\n--- | ---\na | b`, prefix).replace(/\n/gu, ending);
        expect(markdown.parse(source, {}).some((token) => token.type === "table_open")).toBe(false);
        expect(parseEditableTables(source).tables).toEqual([]);
      }
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

describe("ordinary GFM short body rows", () => {
  const header = "| Name | Qty |\n| --- | --- |";
  it.each(["Bob", "  Bob", "`Bob`", "Bob\\|Jones", "#tag", "^", "|", "===", "2.items"])(
    "matches the native table range and padded row at %j", (body) => {
      const source = header + "\n| Alice | 1 |\n" + body + "\n| Carol | 3 |\n\nOutside";
      const native = markdown.parse(source, {});
      const table = parseEditableTables(source).tables[0]!;
      expect(native.find(token => token.type === "table_open")?.map).toEqual([0, 5]);
      expect(table).toMatchObject({ startLine: 0, endLine: 4, structural: false, valid: true });
      const short = table.rows[2]!;
      expect(short.sourceCellCount).toBe(body === "|" ? 0 : 1);
      expect(short.cells.map(cell => cell.content)).toEqual([body === "|" ? "" : body.trim(), ""]);
      expect(short.cells[0]!.covered).toBe(false);
      expect(table.rows[3]!.cells[0]!.content).toBe("Carol");
    },
  );

  it.each(["", "# Next", "- Next", "2. Next", "> next", "***", "---", "_ _ _", "```md",
    "<div>", "<!-- comment --> after", "    code"])("stops short rows before %j", (boundary) => {
    const source = header + "\nBob\n" + boundary + "\n| next | section |";
    const table = parseEditableTables(source).tables[0]!;
    expect(new MarkdownIt({ html: true }).parse(source, {}).find(token => token.type === "table_open")?.map).toEqual([0, 3]);
    expect(table.source).toBe(header + "\nBob");
  });

  it("matches the native end of a wide table at the padded-cell boundary", () => {
    const columns = 257;
    const head = Array<string>(columns).fill("name").join(" | ");
    const delimiter = Array<string>(columns).fill("---").join(" | ");
    const body = Array<string>(257).fill("single");
    const source = [head, delimiter, ...body, "outside"].join("\n");
    const table = parseEditableTables(source).tables[0]!;
    const native = markdown.parse(source, {}).find(token => token.type === "table_open")!;
    expect(native.map).toEqual([0, 258]);
    expect([table.startLine, table.endLine + 1]).toEqual(native.map);
    expect(source.slice(table.range.to)).toBe("\nsingle\noutside");
  });

  it("honors the Obsidian block ID and structural row boundary", () => {
    expect(parseEditableTables(header + "\nBob\n^table-1").tables[0]!.source).toBe(header + "\nBob");
    expect(parseEditableTables(TABLE + "\nBob").tables[0]!.source).toBe(TABLE);
    const lateMerge = parseEditableTables(header + "\nBob\n| Carol | < |\noutside").tables[0]!;
    expect(lateMerge).toMatchObject({ structural: true, valid: false, endLine: 3 });
    expect(lateMerge.diagnostics).toContainEqual(expect.objectContaining({ code: "row-width", row: 2 }));
  });

  it.each([
    { before: "", prefix: "> ", short: ">Bob", next: "outside" },
    { before: "- Item\n\n", prefix: "  ", short: "   Bob", next: "outside" },
    { before: "- Item\n\n", prefix: "  > ", short: "  >Bob", next: "> next quote" },
    { before: "- Outer\n  - Inner\n\n", prefix: "    ", short: "     Bob", next: "  back in outer" },
    { before: "", prefix: "  ", short: "Bob", next: "# heading" },
  ])("keeps the complete ordinary table in its source container at $short", ({ before, prefix, short, next }) => {
    const content = withSourcePrefix(header, prefix) + "\n" + short + "\n" + prefix + "| Carol | 3 |";
    const source = before + content + "\n" + next;
    const token = markdown.parse(source, {}).find(item => item.type === "table_open")!;
    const table = parseEditableTables(source).tables[0]!;
    expect(token.map).toEqual([table.startLine, table.endLine + 1]);
    expect(table).toMatchObject({ source: content, valid: true });
  });
});
