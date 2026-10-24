import { describe, expect, it } from "vitest";
import { editCellContent, insertTableColumn, pasteTableRangeRaw, removeTable, setHeaderRowCount } from "../src/core/operations";
import { validateTableOperationInDocument } from "../src/core/table-operation-document";
import { parseEditableTables } from "../src/core/parser";
import { tableRangePayload } from "../src/core/table-range-clipboard";
import { reparseUnchangedTable, TableDocumentSnapshot } from "../src/core/table-snapshot";

describe("complete-document structural writes", () => {
  it("shares the original parse while retaining complete-result and neighbor validation", () => {
    const note = "| outside | prose | extra |\n| H | V |\n| --- || --- |\n| a | b |\n\n| Keep | Me |\n| --- | --- |";
    const snapshot = new TableDocumentSnapshot(note);
    const table = snapshot.tables[0]!;
    expect(reparseUnchangedTable(snapshot, table)).toBe(table);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.tables)).toBe(true);
    expect(validateTableOperationInDocument(snapshot, table, insertTableColumn(table, 1, "after")).changed).toBe(false);
    expect(validateTableOperationInDocument(snapshot, table, editCellContent(table, 1, 0, "safe")).changed).toBe(true);
    const changed = new TableDocumentSnapshot(note.replace("| a | b |", "| external | b |"));
    expect(reparseUnchangedTable(changed, table)).toBeNull();
    expect(validateTableOperationInDocument(changed, table, editCellContent(table, 1, 0, "stale")).changed).toBe(false);
  });
  it("refuses to absorb adjacent pipe prose as an extra table header", () => {
    const note = "| outside | prose | extra |\n| H | V |\n| --- || --- |\n| a | b |\n| c | d |";
    const table = parseEditableTables(note).tables[0]!;
    expect(table.range.from).toBeGreaterThan(0);
    const inserted = insertTableColumn(table, 1, "after");
    expect(inserted.changed).toBe(true);
    expect(validateTableOperationInDocument(note, table, inserted)).toMatchObject({
      changed: false, code: "invalid-result", source: table.source,
    });
    expect(validateTableOperationInDocument(note, table, setHeaderRowCount(table, 0)).changed).toBe(false);
  });

  it("checks cell-editor commits against the complete note without rejecting safe edits", () => {
    const note = ["Intro", "", "| H | V |", "| --- || --- |", "| a | b |", "", "Outro"].join("\n");
    const table = parseEditableTables(note).tables[0]!;
    const updated = editCellContent(table, 1, 0, "changed");
    expect(updated.changed).toBe(true);
    expect(validateTableOperationInDocument(note, table, updated)).toMatchObject({ changed: true, code: "cell-edited" });
  });
  it("accepts a safe isolated edit without changing neighboring tables", () => {
    const note = "| H | V |\n| --- || --- |\n| a | b |\n\n| X | Y |\n| --- | --- |\n| 1 | 2 |";
    const table = parseEditableTables(note).tables[0]!;
    const inserted = insertTableColumn(table, 1, "after");
    expect(validateTableOperationInDocument(note, table, inserted).changed).toBe(true);
  });

  it("deletes only the chosen table and keeps the following table unchanged", () => {
    const note = ["Intro", "", "| H | V |", "| --- || --- |", "| a | b |", "",
      "| Other | Table |", "| --- | --- |", "| Keep | Data |", "", "Outro"].join("\n");
    const before = parseEditableTables(note).tables;
    expect(before).toHaveLength(2);
    const deleted = removeTable(before[0]!);
    const result = validateTableOperationInDocument(note, before[0]!, deleted);
    expect(result.changed).toBe(true);
    const after = note.slice(0, before[0]!.range.from) + result.source + note.slice(before[0]!.range.to);
    const remaining = parseEditableTables(after).tables;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.source).toBe(before[1]!.source);
  });

  it("refuses a stale cell edit without touching any bytes", () => {
    const oldNote = ["Before", "", "| H | V |", "| --- || --- |", "| a | b |"].join("\n");
    const oldTable = parseEditableTables(oldNote).tables[0]!;
    const nextNote = oldNote.replace("| a | b |", "| changed | b |");
    const candidate = editCellContent(oldTable, 1, 0, "newer");
    expect(validateTableOperationInDocument(nextNote, oldTable, candidate)).toMatchObject({
      changed: false, code: "invalid-result", source: oldTable.source,
    });
  });
  it.each(["\n", "\r\n", "\r"])("pastes into a deeply indented list without misidentifying code for %j", (ending) => {
    const note = ["- Item", "", "    | H | V |", "    | --- || --- |", "    | a | b |", "    | c | d |"].join(ending);
    const table = parseEditableTables(note).tables[0]!;
    const copied = parseEditableTables("| H | V |\n| --- || --- |\n| NEW | OTHER |").tables[0]!;
    const bounds = { minRow: 1, maxRow: 1, minColumn: 0, maxColumn: 0 };
    const payload = tableRangePayload(copied, bounds)!;
    const operation = pasteTableRangeRaw(table, bounds, payload);
    expect(operation.changed).toBe(true);
    expect(validateTableOperationInDocument(note, table, operation).changed).toBe(true);
  });
});
