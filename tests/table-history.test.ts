import { history, redo, undo } from "@codemirror/commands";
import { EditorState, Transaction, type Transaction as EditorTransaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { parseEditableTables } from "../src/core/parser";
import { tableHistory, tableHistoryTarget, tableWriteHistory } from "../src/editor/table-history";

const source = "Before\n\n> [!note]\n> | A | < |\n> | --- | --- |\n> | x | y |\n\nEnd";

describe("table history targets", () => {
  it("uses the host undo stack and maps the target through unrecorded prefix edits", () => {
    let state = EditorState.create({ doc: source, extensions: [history(), tableHistory] });
    const table = parseEditableTables(source).tables[0]!;
    const updated = table.source.replace("x |", "changed | ");
    state = state.update({
      changes: { from: table.range.from, to: table.range.to, insert: updated },
      ...tableWriteHistory(table, updated, "Test.md", { row: 1, column: 0 }),
    }).state;
    state = state.update({ changes: { from: 0, insert: "Prefix\n" }, annotations: Transaction.addToHistory.of(false) }).state;
    let latest: EditorTransaction | undefined;
    const dispatch = (transaction: EditorTransaction): void => { latest = transaction; state = transaction.state; };
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe(`Prefix\n${source}`);
    expect(latest!.effects.find((effect) => effect.is(tableHistoryTarget))?.value).toMatchObject({
      from: table.range.from + 7, after: table.source, coordinate: { row: 1, column: 0 },
    });
    expect(redo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toContain("changed");
    expect(latest!.effects.find((effect) => effect.is(tableHistoryTarget))?.value.after).toBe(updated);
  });

  it("keeps unrelated prose undo separate from the table focus target", () => {
    let state = EditorState.create({ doc: source, extensions: [history(), tableHistory] });
    const table = parseEditableTables(source).tables[0]!;
    state = state.update({
      changes: { from: table.range.from, to: table.range.to, insert: table.source.replace("x |", "changed |") },
      ...tableWriteHistory(table, table.source.replace("x |", "changed |"), "Test.md", { row: 1, column: 0 }),
    }).state;
    state = state.update({ changes: { from: 0, insert: "Text" } }).state;
    let latest: EditorTransaction | undefined;
    const dispatch = (transaction: EditorTransaction): void => { latest = transaction; state = transaction.state; };
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toContain("changed");
    expect(latest!.effects.some((effect) => effect.is(tableHistoryTarget))).toBe(false);
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe(source);
    expect(latest!.effects.some((effect) => effect.is(tableHistoryTarget))).toBe(true);
  });
});
