import type { Transaction } from "@codemirror/state";
import type { StructuralTable } from "../core/model";

const STRUCTURAL_PUNCTUATION = new Set(["\\", "|", "`", "~", ">", "#", "*", "+", "-", "_", "[", "]"]);

function isPlainProseLine(line: string): boolean {
  if (!/^[\p{L}\p{N}]/u.test(line) || !/^[\p{L}\p{N}\p{Zs}\p{P}]+$/u.test(line)) return false;
  if (/^\d{1,9}[.)][\t ]/u.test(line)) return false;
  return ![...line].some((character) => STRUCTURAL_PUNCTUATION.has(character));
}

/** Reuse only edits whose entire old and new line cannot carry Markdown structure. */
export function mapTablesThroughProseEdit(
  tables: readonly StructuralTable[] | null,
  transaction: Transaction,
): readonly StructuralTable[] | null {
  if (tables === null) return null;
  let safe = true;
  transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    const before = transaction.startState.doc.lineAt(fromA);
    const after = transaction.state.doc.lineAt(fromB);
    if (toA > before.to || toB > after.to || inserted.lines !== 1
      || !isPlainProseLine(before.text) || !isPlainProseLine(after.text)
      || tables.some((table) => fromA <= table.range.to && toA >= table.range.from)) safe = false;
  });
  if (!safe) return null;
  return tables.map((table) => ({
    ...table,
    range: {
      from: transaction.changes.mapPos(table.range.from, 1),
      to: transaction.changes.mapPos(table.range.to, -1),
    },
  }));
}
