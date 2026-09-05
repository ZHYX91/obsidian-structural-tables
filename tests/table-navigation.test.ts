import { describe, expect, it } from "vitest";

import { parseStructuralTables } from "../src/core/parser";
import { adjacentTableCell } from "../src/core/table-navigation";

describe("adjacentTableCell", () => {
  const table = parseStructuralTables([
    "| H1 | H2 | H3 |",
    "| --- | --- | --- |",
    "| A | < | B |",
    "| ^ | ^ | C |",
    "| D | E | F |",
  ].join("\n")).tables[0]!;

  it("traverses combined row and column spans symmetrically", () => {
    const anchors = table.rows.flatMap((row) => row.cells.filter((cell) => !cell.covered));
    anchors.forEach((anchor, index) => {
      const previous = anchors[index - 1];
      const next = anchors[index + 1];
      expect(adjacentTableCell(table, anchor, "forward")).toEqual(
        next === undefined ? null : { row: next.row, column: next.column },
      );
      expect(adjacentTableCell(table, anchor, "backward")).toEqual(
        previous === undefined ? null : { row: previous.row, column: previous.column },
      );
    });
  });

  it("resolves a covered coordinate to its owner and rejects out-of-range coordinates", () => {
    expect(adjacentTableCell(table, { row: 2, column: 1 }, "forward")).toEqual({ row: 1, column: 2 });
    expect(adjacentTableCell(table, { row: 99, column: 0 }, "forward")).toBeNull();
    expect(adjacentTableCell(table, { row: 0, column: -1 }, "backward")).toBeNull();
  });
});
