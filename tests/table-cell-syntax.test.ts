import { describe, expect, it } from "vitest";

import { normalizeTableCellInput } from "../src/core/operations";
import { parseEditableTables } from "../src/core/parser";
import { tableCellContentOffset, tableColumnAt } from "../src/core/table-cell-syntax";

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

  it.each(["\u00a0", "\u2007", "\u202f"])("preserves nonbreaking edge spaces %j while trimming ordinary padding", (space) => {
    const entity = `&#${space.codePointAt(0)};`;
    expect(normalizeTableCellInput(` \t${space} A ${space}\t `)).toBe(`${entity} A ${entity}`);
    expect(normalizeTableCellInput(space + space)).toBe(entity + entity);
    expect(normalizeTableCellInput(`A${space}B`)).toBe(`A${space}B`);
    expect(normalizeTableCellInput(`\`A${space}B\``)).toBe(`\`A${space}B\``);
    expect(normalizeTableCellInput(`[[A${space}B]]`)).toBe(`[[A${space}B]]`);
    expect(normalizeTableCellInput(entity + "A" + entity)).toBe(entity + "A" + entity);
  });

  it("maps visible cell content offsets back to the parser's column boundaries", () => {
    for (const [line, expected] of [
      ["| A | B |", [0, 1]],
      ["A | B", [0, 1]],
      ["| `A|B` | C |", [0, 1]],
      ["| A\\|B | C |", [0, 1]],
    ] as const) {
      expected.forEach((column) => {
        const offset = tableCellContentOffset(line, column);
        expect(offset).not.toBeNull();
        expect(tableColumnAt(line, offset! + 1)).toBe(column);
      });
    }
  });

  it("reports structural diagnostics using document source line coordinates", () => {
    const table = parseEditableTables("intro\n\n| A | B |\n| --- || --- |\n| only-one |").tables[0];
    expect(table?.diagnostics[0]).toMatchObject({ code: "row-width", row: 4 });
  });
});
