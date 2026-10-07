import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseEditableTables, parseStructuralTables } from "../src/core/parser";

type ExpectedCell = {
  row: number;
  column: number;
  content?: string;
  marker?: "left" | "up" | null;
};

type ExpectedAnchor = {
  row: number;
  column: number;
  row_span: number;
  column_span: number;
  role: string;
};

type CorpusCase = {
  id: string;
  class: "positive" | "negative" | "false_positive";
  source: string;
  expected: {
    structural_table_count: number;
    editable_table_count?: number;
    editable_structural?: boolean;
    editable_valid?: boolean;
    valid?: boolean;
    header_rows?: number;
    row_header_columns?: number;
    column_count?: number;
    contents?: string[][];
    cells?: ExpectedCell[];
    anchors?: ExpectedAnchor[];
    diagnostic_codes?: string[];
  };
};

type Corpus = {
  schema: string;
  cases: CorpusCase[];
};

const corpus = JSON.parse(
  readFileSync(new URL("./fixtures/interoperability-syntax-contract.json", import.meta.url), "utf8"),
) as Corpus;

describe("Structural Tables interoperability syntax contract", () => {
  it("has a stable corpus identity and all three fixture classes", () => {
    expect(corpus.schema).toBe("structural-tables.interoperability-corpus.v1");
    expect(new Set(corpus.cases.map((fixture) => fixture.class))).toEqual(
      new Set(["positive", "negative", "false_positive"]),
    );
  });

  for (const fixture of corpus.cases) {
    it(fixture.id, () => {
      const structural = parseStructuralTables(fixture.source).tables;
      expect(structural).toHaveLength(fixture.expected.structural_table_count);

      if (fixture.class === "false_positive") {
        const editable = parseEditableTables(fixture.source).tables;
        if (fixture.expected.editable_table_count !== undefined) {
          expect(editable).toHaveLength(fixture.expected.editable_table_count);
        }
        if (editable[0] !== undefined) {
          if (fixture.expected.editable_structural !== undefined) {
            expect(editable[0].structural).toBe(fixture.expected.editable_structural);
          }
          if (fixture.expected.editable_valid !== undefined) {
            expect(editable[0].valid).toBe(fixture.expected.editable_valid);
          }
        }
        return;
      }

      const table = structural[0];
      expect(table).toBeDefined();
      if (table === undefined) return;

      if (fixture.expected.valid !== undefined) expect(table.valid).toBe(fixture.expected.valid);
      if (fixture.expected.header_rows !== undefined) {
        expect(table.headerRowCount).toBe(fixture.expected.header_rows);
      }
      if (fixture.expected.row_header_columns !== undefined) {
        expect(table.rowHeaderColumnCount).toBe(fixture.expected.row_header_columns);
      }
      if (fixture.expected.column_count !== undefined) {
        expect(table.columnCount).toBe(fixture.expected.column_count);
      }
      if (fixture.expected.contents !== undefined) {
        expect(table.rows.map((row) => row.cells.map((cell) => cell.content))).toEqual(
          fixture.expected.contents,
        );
      }
      for (const expected of fixture.expected.cells ?? []) {
        const cell = table.rows[expected.row]?.cells[expected.column];
        expect(cell).toBeDefined();
        if (cell === undefined) continue;
        if (expected.content !== undefined) expect(cell.content).toBe(expected.content);
        if (expected.marker !== undefined) expect(cell.marker ?? null).toBe(expected.marker);
      }
      for (const expected of fixture.expected.anchors ?? []) {
        const cell = table.rows[expected.row]?.cells[expected.column];
        expect(cell).toBeDefined();
        if (cell === undefined) continue;
        expect(cell.covered).toBe(false);
        expect(cell.rowSpan).toBe(expected.row_span);
        expect(cell.columnSpan).toBe(expected.column_span);
        expect(cell.role).toBe(expected.role);
      }
      if (fixture.expected.diagnostic_codes !== undefined) {
        expect(table.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
          expect.arrayContaining(fixture.expected.diagnostic_codes),
        );
      }
    });
  }
});
