import { describe, expect, it } from "vitest";

import { parseStructuralTables } from "../src/core/parser";
import { adjacentTableCell, tableCellInDirection, tableCoordinateInDirection } from "../src/core/table-navigation";

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

  it("moves logical directions by visible owners and skips covered slots", () => {
    expect(tableCellInDirection(table, { row: 1, column: 0 }, "right")).toEqual({ row: 1, column: 2 });
    expect(tableCellInDirection(table, { row: 1, column: 0 }, "down")).toEqual({ row: 3, column: 0 });
    expect(tableCellInDirection(table, { row: 3, column: 1 }, "up")).toEqual({ row: 1, column: 0 });
    expect(tableCellInDirection(table, { row: 1, column: 2 }, "left")).toEqual({ row: 1, column: 0 });
    expect(tableCellInDirection(table, { row: 0, column: 0 }, "up")).toBeNull();
  });

  it("resolves a covered coordinate to its owner and rejects out-of-range coordinates", () => {
    expect(adjacentTableCell(table, { row: 2, column: 1 }, "forward")).toEqual({ row: 1, column: 2 });
    expect(adjacentTableCell(table, { row: 99, column: 0 }, "forward")).toBeNull();
    expect(adjacentTableCell(table, { row: 0, column: -1 }, "backward")).toBeNull();
  });

  it("preserves the covered column through an up/down round trip", () => {
    const horizontal = parseStructuralTables("| Group | < |\n| --- | --- |\n| D | E |").tables[0]!;
    const start = { row: 1, column: 1 };
    const up = tableCoordinateInDirection(horizontal, start, "up")!;
    expect(up).toEqual({ row: 0, column: 1 });
    expect(tableCellInDirection(horizontal, start, "up")).toEqual({ row: 0, column: 0 });
    expect(tableCoordinateInDirection(horizontal, up, "down")).toEqual(start);
    expect(tableCellInDirection(horizontal, up, "down")).toEqual(start);
  });

  it("preserves the covered row through a left/right round trip", () => {
    const vertical = parseStructuralTables("| H1 | H2 |\n| --- | --- |\n| North | E1 |\n| ^ | E2 |").tables[0]!;
    const start = { row: 2, column: 1 };
    const left = tableCoordinateInDirection(vertical, start, "left")!;
    expect(left).toEqual({ row: 2, column: 0 });
    expect(tableCellInDirection(vertical, start, "left")).toEqual({ row: 1, column: 0 });
    expect(tableCoordinateInDirection(vertical, left, "right")).toEqual(start);
    expect(tableCellInDirection(vertical, left, "right")).toEqual(start);
  });

  it("exits the current owner span and refuses destinations outside the table", () => {
    expect(tableCoordinateInDirection(table, { row: 2, column: 1 }, "down")).toEqual({ row: 3, column: 1 });
    expect(tableCoordinateInDirection(table, { row: 2, column: 1 }, "up")).toEqual({ row: 0, column: 1 });
    expect(tableCoordinateInDirection(table, { row: 2, column: 1 }, "right")).toEqual({ row: 2, column: 2 });
    expect(tableCoordinateInDirection(table, { row: 2, column: 1 }, "left")).toBeNull();
    expect(tableCoordinateInDirection(table, { row: 0, column: 0 }, "up")).toBeNull();
    expect(tableCoordinateInDirection(table, { row: 3, column: 2 }, "down")).toBeNull();
    expect(tableCoordinateInDirection(table, { row: 3, column: 2 }, "right")).toBeNull();
    expect(tableCoordinateInDirection(table, { row: 99, column: 0 }, "up")).toBeNull();
  });
});
