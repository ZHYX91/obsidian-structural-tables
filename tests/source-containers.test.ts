import { describe, expect, it } from "vitest";
import { parseStructuralTables } from "../src/core/parser";
import { serializeStructuralTable } from "../src/core/serializer";
import { cellColumnAt, editCellContent, insertTableRow, splitCell } from "../src/core/operations";
import { withSourcePrefix } from "../src/core/source-lines";
import { buildBasePromotionPlan } from "../src/core/base-promotion";

const tableSource = "| A | < |\n| --- | --- |\n| x | y |";

describe("source containers", () => {
  it("refuses nested Base promotion before producing files or replacement source", () => {
    const table = parseStructuralTables(withSourcePrefix(tableSource, "> ")).tables[0]!;
    expect(() => buildBasePromotionPlan(table, "example")).toThrow("outside its Markdown container");
  });
  it.each(["\n", "\r\n", "\r"])("preserves source offsets and terminators %j", (ending) => {
    const source = `Intro${ending}${ending}${tableSource.replace(/\n/gu, ending)}${ending}End`;
    const table = parseStructuralTables(source).tables[0]!;
    expect(table.valid).toBe(true);
    expect(source.slice(table.range.from, table.range.to)).toBe(tableSource.replace(/\n/gu, ending));
    const result = editCellContent(table, 1, 0, "changed");
    expect(result.changed).toBe(true);
    expect(parseStructuralTables(result.source).tables[0]?.rows[1]?.cells[0]?.content).toBe("changed");
    expect(result.source.split(ending)).toHaveLength(3);
    expect(source.slice(table.range.to)).toBe(`${ending}End`);
  });

  it.each(["> ", ">> ", "> > ", "  ", "   "])("preserves %j through formatting and edits", (prefix) => {
    const source = withSourcePrefix(tableSource, prefix);
    const table = parseStructuralTables(source).tables[0]!;
    expect(table.valid).toBe(true);
    for (const result of [serializeStructuralTable(table), editCellContent(table, 1, 0, "changed").source,
      insertTableRow(table, 1, "after").source, splitCell(table, 0, 0).source]) {
      expect(result.split("\n").every((line) => line.startsWith(prefix + "|"))).toBe(true);
    }
    expect(cellColumnAt(prefix + "| A | B |", prefix.length + 3)).toBe(0);
    expect(cellColumnAt(prefix + "| A | B |", prefix.length + 7)).toBe(1);
  });

  it("recognizes indented list continuations but excludes their code blocks", () => {
    const source = "- outer\n  - inner\n\n" + withSourcePrefix(tableSource, "    ");
    const table = parseStructuralTables(source).tables[0]!;
    expect(table.sourcePrefix).toBe("    ");
    const result = editCellContent(table, 1, 0, "changed");
    expect(result.changed).toBe(true);
    expect(parseStructuralTables(source.slice(0, table.range.from) + result.source).tables[0]?.valid).toBe(true);
    expect(parseStructuralTables("- outer\n\n" + withSourcePrefix(tableSource, "      ")).tables).toEqual([]);
    expect(parseStructuralTables(withSourcePrefix(tableSource, "    ")).tables).toEqual([]);
  });

  it.each(["---", "..."])("ignores an indented YAML scalar delimiter %s", (delimiter) => {
    const source = `---\nexample: |\n  ${delimiter}\n${withSourcePrefix(tableSource, "  ")}\n---\n\n${tableSource}`;
    const tables = parseStructuralTables(source).tables;
    expect(tables).toHaveLength(1);
    expect(tables[0]?.startLine).toBe(8);
  });

  it.each(["> ", ">> ", "  "])("excludes fences inside %j", (prefix) => {
    expect(parseStructuralTables(withSourcePrefix("```md\n" + tableSource + "\n```", prefix)).tables).toEqual([]);
  });

  it("does not join rows across containers or leak quote fences", () => {
    const source = withSourcePrefix(tableSource, "> ") + "\n| outside | row |\n\n> ```md\n> code\n\n" + tableSource;
    const tables = parseStructuralTables(source).tables;
    expect(tables).toHaveLength(2);
    expect(tables[0]?.rows).toHaveLength(2);
    expect(tables[1]?.valid).toBe(true);
  });

  it("keeps quoted examples inside top-level and quoted fences protected", () => {
    expect(parseStructuralTables("```md\n> example\n" + tableSource + "\n```").tables).toEqual([]);
    expect(parseStructuralTables("> ```md\n> > example\n" + withSourcePrefix(tableSource, "> ") + "\n> ```").tables).toEqual([]);
  });
});
