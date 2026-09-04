import { describe, expect, it } from "vitest";

import { parseEditableTables, parseStructuralTables } from "../src/core/parser";
import { markdownSourceDisplayWidth, serializeStructuralTable } from "../src/core/serializer";

function separatorColumns(line: string): number[] {
  const columns: number[] = [];
  let escaped = false;
  let codeTicks = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "`") {
      let run = 1;
      while (line[index + run] === "`") run += 1;
      if (codeTicks === 0) codeTicks = run;
      else if (codeTicks === run) codeTicks = 0;
      index += run - 1;
      continue;
    }
    if (character === "|" && codeTicks === 0) {
      columns.push(markdownSourceDisplayWidth(line.slice(0, index)));
    }
  }
  return columns;
}

describe("serializeStructuralTable", () => {
  it("writes canonical merge markers and delimiter alignment", () => {
    const source = "| Group | < |\n| Name | Value |\n| :--- | ---: |\n| North | 1 |\n| ^ | 2 |";
    const table = parseStructuralTables(source).tables[0];
    expect(table?.valid).toBe(true);
    expect(serializeStructuralTable(table!)).toBe(`| Group | <     |
| Name  | Value |
| :---  | ---:  |
| North | 1     |
| ^     | 2     |`);
  });

  it("escapes literal marker content", () => {
    const source = String.raw`| Group | \< |
| Name | Value |
| --- | --- |
| A | B |`;
    const table = parseStructuralTables(source).tables[0];
    expect(serializeStructuralTable(table!)).toContain(String.raw`| Group | \<`);
  });

  it("refuses to serialize an invalid table", () => {
    const table = parseStructuralTables("| < | B |\n| --- | --- |\n| 1 | 2 |").tables[0];
    expect(() => serializeStructuralTable(table!)).toThrow("invalid");
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("preserves %s when formatting a structural table", (_name, ending) => {
    const lfSource = "| Group | < |\n| Name | Value |\n| --- | --- |\n| A | B |";
    const parsed = parseStructuralTables(lfSource).tables[0]!;
    const serialized = serializeStructuralTable({ ...parsed, source: lfSource.replace(/\n/gu, ending) });

    expect(serialized.split(ending)).toHaveLength(4);
    if (ending === "\r\n") expect(serialized).not.toMatch(/(?<!\r)\n/u);
    else if (ending === "\r") expect(serialized).not.toContain("\n");
    else expect(serialized).not.toContain("\r");
  });

  it.each(["<br>", "<br/>", "<br />"])("preserves the exact %s visual-break spelling", (tag) => {
    const source = `| Name | Note |\n| --- || --- |\n| Alice | First${tag}Second |`;
    const table = parseStructuralTables(source).tables[0];

    expect(table?.valid).toBe(true);
    const serialized = serializeStructuralTable(table!);
    expect(serialized).toContain(`First${tag}Second`);
    expect(parseStructuralTables(serialized).tables[0]?.rows[1]?.cells[1]?.content)
      .toBe(`First${tag}Second`);
  });

  it("aligns source pipes by display width without splitting escaped pipes or code spans", () => {
    const source = [
      "| 名称 | 内容 |",
      "| --- | --- |",
      "| Alpha | [[Target\\|Alias]] |",
      "| 测试 | `a|b` \\| c |",
    ].join("\n");
    const table = parseEditableTables(source).tables[0]!;
    const serialized = serializeStructuralTable(table);
    const pipeColumns = serialized.split("\n").map(separatorColumns);

    expect(pipeColumns.every((columns) => JSON.stringify(columns) === JSON.stringify(pipeColumns[0]))).toBe(true);
    expect(parseEditableTables(serialized).tables[0]?.rows[1]?.cells[1]?.content)
      .toBe(String.raw`[[Target\|Alias]]`);
    expect(parseEditableTables(serialized).tables[0]?.rows[2]?.cells[1]?.content)
      .toBe("`a|b` \\| c");
    expect(serializeStructuralTable(parseEditableTables(serialized).tables[0]!)).toBe(serialized);
  });

  it("uses terminal display widths for CJK, combining marks, and emoji graphemes", () => {
    expect(markdownSourceDisplayWidth("A名称e\u0301🙂")).toBe(8);
  });

  it("keeps the second row-header divider pipe aligned with ordinary row separators", () => {
    const source = "| Name | Note |\n| --- || --- |\n| Alice | Value |";
    const serialized = serializeStructuralTable(parseStructuralTables(source).tables[0]!);
    const [header, delimiter, data] = serialized.split("\n");

    expect(delimiter).toContain("||");
    expect(separatorColumns(delimiter ?? "").filter((_column, index) => index !== 1))
      .toEqual(separatorColumns(header ?? ""));
    expect(separatorColumns(data ?? "")).toEqual(separatorColumns(header ?? ""));
  });
});
