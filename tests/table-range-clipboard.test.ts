import { describe, expect, it } from "vitest";

import { pasteTableRangeRaw } from "../src/core/operations";
import { parseEditableTables, parseStructuralTables } from "../src/core/parser";
import {
  parseTableRangePayload,
  sameTableRangeTopology,
  tableRangeHtml,
  tableRangePayload,
  tableRangePlainText,
} from "../src/core/table-range-clipboard";

describe("table range clipboard payload", () => {
  it("normalizes one owner matrix without absolute coordinates and preserves raw source tokens", () => {
    const source = [
      "| Group | < | Note |",
      "| --- | --- | --- |",
      "| **North** | < | [[Target\\|Alias]] |",
      "| ^ | < | `a\\|b`<br>$x$ |",
    ].join("\n");
    const table = parseStructuralTables(source).tables[0]!;
    const payload = tableRangePayload(table, {
      minRow: 0, maxRow: 3, minColumn: 0, maxColumn: 2,
    })!;

    expect(payload).toMatchObject({
      version: 1,
      rows: 4,
      columns: 3,
      owners: [
        ["o0", "o0", "o1"],
        ["o2", "o3", "o4"],
        ["o5", "o5", "o6"],
        ["o5", "o5", "o7"],
      ],
    });
    expect(payload.rawByOwner).toMatchObject({
      o0: "Group",
      o5: "**North**",
      o6: String.raw`[[Target\|Alias]]`,
      o7: "`a\\|b`<br>$x$",
    });
    expect(parseTableRangePayload(JSON.stringify(payload))).toEqual(payload);
  });

  it.each([
    {
      name: "single cell",
      source: "| A | B |\n| --- | --- |\n| one | two |",
      bounds: { minRow: 1, maxRow: 1, minColumn: 0, maxColumn: 0 },
      expected: "| one |\n| --- |",
    },
    {
      name: "single column",
      source: "| A | B |\n| --- | --- |\n| one | two |\n| three | four |",
      bounds: { minRow: 1, maxRow: 2, minColumn: 0, maxColumn: 0 },
      expected: "| one |\n| --- |\n| three |",
    },
    {
      name: "all empty",
      source: "| A | B |\n| --- | --- |\n|  |  |",
      bounds: { minRow: 1, maxRow: 1, minColumn: 0, maxColumn: 1 },
      expected: "|  |  |\n| --- | --- |",
    },
  ])("exports bounded plain GFM for $name", ({ source, bounds, expected }) => {
    const table = parseEditableTables(source).tables[0]!;
    expect(tableRangePlainText(tableRangePayload(table, bounds)!)).toBe(expected);
  });

  it("renders synchronous HTML geometry without interpreting raw Markdown", () => {
    const table = parseStructuralTables("| **A** | < |\n| --- | --- |\n| ^ | < |").tables[0]!;
    const payload = tableRangePayload(table, { minRow: 0, maxRow: 1, minColumn: 0, maxColumn: 1 })!;
    expect(tableRangeHtml(payload)).toBe(
      '<table><thead><tr><th rowspan="2" colspan="2">**A**</th></tr></thead><tbody><tr></tr></tbody></table>',
    );
  });

  it("rejects partial merged owners and malformed/noncanonical payloads", () => {
    const table = parseStructuralTables("| A | < | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |").tables[0]!;
    expect(tableRangePayload(table, { minRow: 0, maxRow: 0, minColumn: 0, maxColumn: 0 })).toBeNull();
    expect(parseTableRangePayload('{"version":1,"rows":1,"columns":1,"owners":[["o1"]],"rawByOwner":{"o1":"x"}}')).toBeNull();
    expect(parseTableRangePayload('{"version":1,"rows":1,"columns":2,"owners":[["o0"]],"rawByOwner":{"o0":"x"}}')).toBeNull();
  });

  it.each([
    {
      name: "ordinary rectangle",
      source: "| H1 | H2 |\n| --- | --- |\n| **A** | [[N\\|A]] |\n| `x\\|y` | $z$<br>next |",
      bounds: { minRow: 1, maxRow: 2, minColumn: 0, maxColumn: 1 },
    },
    {
      name: "headerless range",
      source: "| --- | --- |\n| **A** | B |\n| C | [[N\\|A]] |",
      bounds: { minRow: 0, maxRow: 1, minColumn: 0, maxColumn: 1 },
    },
    {
      name: "multi-header range",
      source: "| Group | < |\n| H1 | H2 |\n| --- | --- |\n| A | B |",
      bounds: { minRow: 0, maxRow: 1, minColumn: 0, maxColumn: 1 },
    },
    {
      name: "horizontal merge",
      source: "| A | < | C |\n| --- | --- | --- |\n| D | E | F |",
      bounds: { minRow: 0, maxRow: 0, minColumn: 0, maxColumn: 1 },
    },
    {
      name: "vertical merge",
      source: "| A | B |\n| --- | --- |\n| C | D |\n| ^ | E |",
      bounds: { minRow: 1, maxRow: 2, minColumn: 0, maxColumn: 0 },
    },
  ])("round-trips exact raw owners for $name", ({ source, bounds }) => {
    const table = parseEditableTables(source).tables[0]!;
    const payload = tableRangePayload(table, bounds)!;
    const result = pasteTableRangeRaw(table, bounds, payload);
    expect(result).toMatchObject({ changed: false, code: "range-pasted", source: table.source });
    expect(parseTableRangePayload(JSON.stringify(payload))).toEqual(payload);
  });

  it("pastes raw content only when size and owner topology exactly match", () => {
    const source = [
      "| H | V | W |",
      "| --- | --- | --- |",
      "| **A** | < | [[N\\|A]] |",
      "| ^ | < | `x\\|y` |",
    ].join("\n");
    const targetSource = [
      "| X | Y | Z |",
      "| --- | --- | --- |",
      "| old | < | q |",
      "| ^ | < | r |",
    ].join("\n");
    const sourceTable = parseStructuralTables(source).tables[0]!;
    const target = parseStructuralTables(targetSource).tables[0]!;
    const bounds = { minRow: 1, maxRow: 2, minColumn: 0, maxColumn: 2 };
    const payload = tableRangePayload(sourceTable, bounds)!;
    const targetPayload = tableRangePayload(target, bounds)!;
    expect(sameTableRangeTopology(payload, targetPayload)).toBe(true);

    const result = pasteTableRangeRaw(target, bounds, payload);
    expect(result).toMatchObject({ changed: true, code: "range-pasted" });
    const pasted = parseStructuralTables(result.source).tables[0]!;
    expect(pasted.rows[1]!.cells[0]!.raw.trim()).toBe("**A**");
    expect(pasted.rows[1]!.cells[2]!.raw.trim()).toBe(String.raw`[[N\|A]]`);
    expect(pasted.rows[2]!.cells[2]!.raw.trim()).toBe("`x\\|y`");
    expect(pasted.headerRowCount).toBe(target.headerRowCount);
    expect(pasted.alignments).toEqual(target.alignments);
  });

  it("refuses size, topology, hidden-overflow, and unsafe raw mismatches without partial writes", () => {
    const target = parseStructuralTables("| H | V |\n| --- | --- |\n| A | B |\n| C | D |").tables[0]!;
    const source = parseStructuralTables("| X | < |\n| --- | --- |\n| Y | Z |").tables[0]!;
    const payload = tableRangePayload(source, { minRow: 0, maxRow: 1, minColumn: 0, maxColumn: 1 })!;
    expect(pasteTableRangeRaw(target, { minRow: 1, maxRow: 2, minColumn: 0, maxColumn: 1 }, payload))
      .toMatchObject({ changed: false, code: "invalid-result", source: target.source });

    const ordinary = parseEditableTables("| A | B |\n| --- | --- |\n| 1 | 2 | KEEP |").tables[0]!;
    const one = tableRangePayload(parseEditableTables("| A |\n| --- |\n| x |").tables[0]!, {
      minRow: 1, maxRow: 1, minColumn: 0, maxColumn: 0,
    })!;
    expect(pasteTableRangeRaw(ordinary, { minRow: 1, maxRow: 1, minColumn: 0, maxColumn: 0 }, one))
      .toMatchObject({ changed: false, code: "gfm-overflow-readonly", source: ordinary.source });

    const bad = structuredClone(one);
    bad.rawByOwner.o0 = "|";
    expect(pasteTableRangeRaw(parseEditableTables("| A |\n| --- |\n| y |").tables[0]!, {
      minRow: 1, maxRow: 1, minColumn: 0, maxColumn: 0,
    }, bad)).toMatchObject({ changed: false, code: "invalid-result" });
  });
});
