import type { Transaction } from "@codemirror/state";
import type { StructuralTable } from "../core/model";

/** Reuse only edits whose entire old and new line cannot carry Markdown structure. */
export function mapTablesThroughProseEdit(
  tables: readonly StructuralTable[] | null,
  transaction: Transaction,
): readonly StructuralTable[] | null {
  if (tables === null) return null;
  const prose = (text: string): boolean => text.trim() !== ""
    // Any angle bracket can open/close literal HTML ownership, including a
    // declaration begun on an earlier line. Reparse rather than duplicating
    // the context-sensitive HTML rules from the complete Markdown scanner.
    && !/[|`~:<>]/u.test(text)
    && !/(?:%%|<!--|-->|\$\$)/u.test(text)
    // Headings and thematic/setext lines can end a paragraph, allowing a
    // following standalone HTML tag to start a block without a blank line.
    && !/^ {0,3}(?:#{1,6}(?:[\t ]|$)|(?:\*[\t ]*){3,}$|(?:_[\t ]*){3,}$|(?:=+|-+)[\t ]*$)/u.test(text)
    && !/^(?:\uFEFF?(?:---|\.\.\.)[\t ]*$| {0,3}>| {4}|\t| {0,3}(?:[-+*]|\d{1,9}[.)])[\t ]{1,4}(?=\S))/u.test(text);
  let safe = true;
  transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    const before = transaction.startState.doc.lineAt(fromA);
    const after = transaction.state.doc.lineAt(fromB);
    if (toA > before.to || toB > after.to || inserted.lines !== 1
      || !prose(before.text) || !prose(after.text)
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
