import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { planTransposeTable } from "../src/core/operations";
import { parseEditableTables } from "../src/core/parser";

function tables(name: string) {
  const result = parseEditableTables(readFileSync(`acceptance/fixtures/${name}.md`, "utf8"));
  expect(result.tables.every((table) => table.valid)).toBe(true);
  return result.tables;
}

describe("focused host acceptance fixtures", () => {
  it("actually exercises native syntax/alignment confirmation and a merged owned transpose", () => {
    const [native, owned] = tables("Transpose and history");
    expect(native?.structural).toBe(false);
    expect(planTransposeTable(native!)).toMatchObject({ resetsColumnAlignment: true, introducesStructuralSyntax: true, result: { changed: true } });
    expect(owned?.structural).toBe(true);
    expect(owned?.rows.some((row) => row.cells.some((cell) => cell.rowSpan === 2))).toBe(true);
    expect(planTransposeTable(owned!)).toMatchObject({ resetsColumnAlignment: true, result: { changed: true } });
  });

  it("keeps the focus target below a long merged table and retains mixed RTL source order", () => {
    const [tall] = tables("Final cell focus");
    expect(tall?.rows).toHaveLength(25);
    expect(tall?.columnCount).toBe(5);
    expect(tall?.rows[24]?.cells[4]?.content).toBe("last-24");
    expect(tall?.rows.flatMap((row) => row.cells).filter((cell) => cell.rowSpan === 2)).toHaveLength(12);
    const [mixed] = tables("Language and RTL");
    expect(mixed?.rowHeaderColumnCount).toBe(1);
    expect(mixed?.rows[1]?.cells.map((cell) => cell.content)).toEqual(["North", "ABC-123", "مرحبا ١٢٣", "00123"]);
  });
});
