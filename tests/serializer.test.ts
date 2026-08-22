import { describe, expect, it } from "vitest";

import { parseStructuralTables } from "../src/core/parser";
import { serializeStructuralTable } from "../src/core/serializer";

describe("serializeStructuralTable", () => {
  it("writes canonical merge markers and delimiter alignment", () => {
    const source = "| Group | < |\n| Name | Value |\n| :--- | ---: |\n| North | 1 |\n| ^ | 2 |";
    const table = parseStructuralTables(source).tables[0];
    expect(table?.valid).toBe(true);
    expect(serializeStructuralTable(table!)).toBe(source);
  });

  it("escapes literal marker content", () => {
    const source = String.raw`| Group | \< |
| Name | Value |
| --- | --- |
| A | B |`;
    const table = parseStructuralTables(source).tables[0];
    expect(serializeStructuralTable(table!)).toContain(String.raw`| Group | \< |`);
  });

  it("refuses to serialize an invalid table", () => {
    const table = parseStructuralTables("| < | B |\n| --- | --- |\n| 1 | 2 |").tables[0];
    expect(() => serializeStructuralTable(table!)).toThrow("invalid");
  });
});
