import { describe, expect, it } from "vitest";
import { insertTableColumn, pasteTableRangeRaw, setHeaderRowCount } from "../src/core/operations";
import { validateTableOperationInDocument } from "../src/core/table-operation-document";
import { parseEditableTables } from "../src/core/parser";
import { tableRangePayload } from "../src/core/table-range-clipboard";

describe("complete-document structural writes", () => {
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

  it("accepts a safe isolated edit without changing neighboring tables", () => {
    const note = "| H | V |\n| --- || --- |\n| a | b |\n\n| X | Y |\n| --- | --- |\n| 1 | 2 |";
    const table = parseEditableTables(note).tables[0]!;
    const inserted = insertTableColumn(table, 1, "after");
    expect(validateTableOperationInDocument(note, table, inserted).changed).toBe(true);
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
