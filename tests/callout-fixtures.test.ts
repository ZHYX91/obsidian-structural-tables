import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEditableTables } from "../src/core/parser";
import { calloutRanges } from "../src/core/source-lines";

describe("callout acceptance source", () => {
  it("keeps the positive scenarios valid and the deliberate negative scenario invalid", () => {
    const source = readFileSync(new URL("../acceptance/fixtures/Callout mapping.md", import.meta.url), "utf8");
    const tables = parseEditableTables(source).tables;
    expect(tables).toHaveLength(11);
    expect(tables.filter((table) => table.valid && table.structural)).toHaveLength(9);
    expect(tables.filter((table) => !table.valid)).toHaveLength(1);
    expect(tables.find((table) => !table.valid)?.diagnostics.every((item) => item.code === "row-width")).toBe(true);
    expect(tables.filter((table) => table.valid && table.rowHeaderColumnCount === 1)).toHaveLength(2);
    expect(tables.filter((table) => table.headerRowCount === 2)).toHaveLength(1);
  });

  it.each(["\n", "\r\n", "\r"])("identifies indented and nested callout source ranges with %j endings", (ending) => {
    const lines = ["- List", "", "    > [!note] Outer", "    > > [!custom]+ Inner", "    > > body", "", "End"];
    const source = lines.join(ending);
    const ranges = calloutRanges(source);
    expect(ranges).toHaveLength(1);
    expect(source.slice(ranges[0]!.from, ranges[0]!.to)).toBe(lines.slice(2, 5).join(ending));
  });
});
