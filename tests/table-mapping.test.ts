import { describe, expect, it } from "vitest";

import { parseStructuralTables } from "../src/core/parser";
import { renderedTableFor } from "../src/reading/table-mapping";

describe("renderedTableFor", () => {
  it("selects the structural DOM table after an ordinary Markdown table", () => {
    const source = "| Plain | Table |\n| --- | --- |\n| 1 | 2 |\n\n| A | < |\n| --- | --- |";
    const table = parseStructuralTables(source).tables[0]!;
    const ordinary = { kind: "ordinary" };
    const structural = { kind: "structural" };
    expect(renderedTableFor([ordinary, structural], table)).toBe(structural);
  });
});
