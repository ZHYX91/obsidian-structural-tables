// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEditableTables } from "../src/core/parser";
import { bindTableSourceSnapshot } from "../src/editor/table-source-binding";

interface Fixture { id: string; sourcePath: string; source: string; tables: { from: number; to: number; source: string }[] }
const contract = JSON.parse(readFileSync("tests/fixtures/structural-table-source-contract.json", "utf8")) as { schema: string; cases: Fixture[] };

describe("offline Structural Tables / Number Suite source snapshot contract", () => {
  it.each(contract.cases)("publishes exact UTF-16 source identity for $id", (fixture) => {
    expect(contract.schema).toBe("structural-tables.source-snapshot.v1");
    const tables = parseEditableTables(fixture.source).tables;
    expect(tables).toHaveLength(fixture.tables.length);
    for (const [index, table] of tables.entries()) {
      const expected = fixture.tables[index]!;
      expect(table.valid).toBe(true);
      expect(table.range).toEqual({ from: expected.from, to: expected.to });
      expect(table.source).toBe(expected.source);
      expect(fixture.source.slice(expected.from, expected.to)).toBe(expected.source);
      const host = document.createElement("div");
      bindTableSourceSnapshot(host, table, fixture.sourcePath);
      expect({ ...host.dataset }).toEqual({
        structuralSourceVersion: "1", structuralSourcePath: fixture.sourcePath,
        structuralSourceFrom: String(expected.from), structuralSourceTo: String(expected.to),
        structuralSource: expected.source, structuralSourceTableIndex: String(index),
      });
    }
  });
});
