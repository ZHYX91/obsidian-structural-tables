import { describe, expect, it } from "vitest";

import { planTransposeTable, transposeTable } from "../src/core/operations";
import { parseEditableTables } from "../src/core/parser";
import type { StructuralTable } from "../src/core/model";
import { transposeTableInDocument } from "../src/core/table-transpose-validation";

const tick = String.fromCharCode(96);
const contents = ["", "北方😀", "\\<", "\\^", "a\\|b", tick + "a|b" + tick,
  "[[Note\\|Alias]]", "$P(A\\mid B)$", "one<br>two"];

function generator(seed: number): (max: number) => number {
  let state = seed >>> 0;
  return (max) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
}

function shape(table: StructuralTable) {
  return {
    rows: table.rows.length,
    columns: table.columnCount,
    h: table.headerRowCount,
    q: table.rowHeaderColumnCount,
    cells: table.rows.map((row) => row.cells.map((cell) => ({
      content: cell.content,
      role: cell.role,
      covered: cell.covered,
      owner: [cell.anchorRow, cell.anchorColumn],
      span: cell.covered ? null : [cell.rowSpan, cell.columnSpan],
    }))),
  };
}

describe("deterministic transpose property regressions", () => {
  it("preserves owner contents, roles, spans and full-container source for 160 generated legal tables", () => {
    for (let seed = 1; seed <= 160; seed += 1) {
      const random = generator(seed * 1777);
      const R = 2 + random(5);
      const C = 2 + random(5);
      const H = random(R);
      const Q = random(C);
      const cells: Array<Array<string | null>> = Array.from({ length: R }, () => Array(C).fill(null));
      for (let row = 0; row < R; row += 1) for (let col = 0; col < C; col += 1) {
        if (cells[row]![col] !== null) continue;
        const edgeR = row < H ? H : R;
        const edgeC = col < Q ? Q : C;
        let dr = 1 + random(Math.min(2, edgeR - row));
        let dc = 1 + random(Math.min(2, edgeC - col));
        if (random(3) === 0 || Array.from({ length: dr }, (_unused, i) =>
          cells[row + i]!.slice(col, col + dc)).flat().some((item) => item !== null)) {
          dr = 1;
          dc = 1;
        }
        for (let r = 0; r < dr; r += 1) for (let c = 0; c < dc; c += 1) {
          cells[row + r]![col + c] = r === 0 && c === 0
            ? contents[random(contents.length)]! : r === 0 ? "<" : "^";
        }
      }
      const delimiter = Array.from({ length: C }, () => random(4) === 0 ? ":---:" : "---");
      const delim = Q === 0 ? "| " + delimiter.join(" | ") + " |"
        : "| " + delimiter.slice(0, Q).join(" | ") + " || " + delimiter.slice(Q).join(" | ") + " |";
      const rows = cells.map((row) => "| " + row.join(" | ") + " |");
      rows.splice(H, 0, delim);
      const ending = seed % 2 === 0 ? "\r\n" : "\n";
      const prefix = seed % 3 === 0 ? "> " : seed % 3 === 1 ? "    " : "";
      const context = prefix === "    " ? "- Item" + ending + ending : "";
      const source = context + rows.map((line) => prefix + line).join(ending);
      const before = parseEditableTables(source).tables[0];
      expect(before?.valid, "seed=" + seed + " input=" + source).toBe(true);
      const first = planTransposeTable(before!);
      expect(first.result.changed, "seed=" + seed + " code=" + first.result.code).toBe(true);
      expect(transposeTableInDocument(source, before!)).toEqual(first.result);
      const output = source.slice(0, before!.range.from) + first.result.source + source.slice(before!.range.to);
      const after = parseEditableTables(output).tables[0];
      expect(after?.valid, "seed=" + seed + " output=" + output).toBe(true);
      expect(after!.rows.length).toBe(C);
      expect(after!.columnCount).toBe(R);
      for (let row = 0; row < R; row += 1) for (let col = 0; col < C; col += 1) {
        const oldCell = before!.rows[row]!.cells[col]!;
        const newCell = after!.rows[col]!.cells[row]!;
        expect(newCell.content).toBe(oldCell.content);
        expect(newCell.anchorRow).toBe(oldCell.anchorColumn);
        expect(newCell.anchorColumn).toBe(oldCell.anchorRow);
        if (!oldCell.covered) {
          expect(newCell.rowSpan).toBe(oldCell.columnSpan);
          expect(newCell.columnSpan).toBe(oldCell.rowSpan);
        }
      }
      const backward = transposeTable(after!);
      expect(backward.changed, "seed=" + seed + " second=" + backward.code).toBe(true);
      const restoredSource = output.slice(0, after!.range.from) + backward.source + output.slice(after!.range.to);
      const restored = parseEditableTables(restoredSource).tables[0];
      expect(restored?.valid).toBe(true);
      expect(shape(restored!)).toEqual(shape(before!));
    }
  });
});
