import { describe, expect, it } from "vitest";

import { normalizeTableCellFragment, normalizeTableCellInput } from "../src/core/operations";
import { parseEditableTables } from "../src/core/parser";

describe("table cell syntax", () => {
  it("treats unmatched and escaped backticks as text rather than hiding pipe separators", () => {
    const unmatched = parseEditableTables("| A | B |\n| --- | --- |\n| `literal | tail |").tables[0];
    expect(unmatched?.valid).toBe(true);
    expect(unmatched?.rows[1]?.cells).toHaveLength(2);

    const escaped = parseEditableTables("| A | B |\n| --- | --- |\n| \\`literal | tail |").tables[0];
    expect(escaped?.valid).toBe(true);
    expect(escaped?.rows[1]?.cells).toHaveLength(2);
  });

  it("keeps a pipe inside a closed code span even when a backslash precedes its closing run", () => {
    const table = parseEditableTables("| A | B |\n| --- | --- |\n| `code|x\\` | tail |").tables[0];
    expect(table?.valid).toBe(true);
    expect(table?.rows[1]?.cells).toHaveLength(2);
    expect(table?.rows[1]?.cells[0]?.content).toBe("`code|x\\`");
  });

  it("keeps closed code spans opaque while escaping ordinary pipes", () => {
    expect(normalizeTableCellInput("before | `code|span` | after"))
      .toBe("before \\| `code|span` \\| after");
  });

  it("preserves fragment boundary whitespace during paste normalization", () => {
    expect(normalizeTableCellFragment(" brave ")).toBe(" brave ");
    expect(normalizeTableCellFragment(" a|b ")).toBe(" a|b ");
  });

  it("reports diagnostics using document source line coordinates", () => {
    const table = parseEditableTables("intro\n\n| A | B |\n| --- | --- |\n| only-one |").tables[0];
    expect(table?.diagnostics[0]?.row).toBe(4);
  });
});
