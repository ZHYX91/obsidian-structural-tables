import type { Transaction } from "@codemirror/state";
import type { StructuralTable } from "../core/model";

/** Reuse only edits whose entire old and new line cannot carry Markdown structure. */
export function mapTablesThroughProseEdit(
  tables: readonly StructuralTable[] | null,
  transaction: Transaction,
): readonly StructuralTable[] | null {
  if (tables === null) return null;
  const prose = /^[\p{L}\p{N}][\p{L}\p{N} ,!?;()]*$/u;
  let safe = true;
  transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    const before = transaction.startState.doc.lineAt(fromA);
    const after = transaction.state.doc.lineAt(fromB);
    if (toA > before.to || toB > after.to || inserted.lines !== 1
      || !prose.test(before.text) || !prose.test(after.text)
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
