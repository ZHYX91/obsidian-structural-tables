import { describe, expect, it } from "vitest";

import { parseStructuralTables } from "../src/core/parser";
import { reparseUnchangedTable } from "../src/core/table-snapshot";

const source = "Before\n\n| A | < |\n| --- | --- |\n\nAfter";

describe("reparseUnchangedTable", () => {
  it("returns a fresh parse only while the captured range and source are unchanged", () => {
    const expected = parseStructuralTables(source).tables[0]!;
    expect(reparseUnchangedTable(source, expected)).not.toBe(expected);
    expect(reparseUnchangedTable(`${source}\nLater`, expected)?.source).toBe(expected.source);
    expect(reparseUnchangedTable(source.replace("| A | < |", "| B | < |"), expected)).toBeNull();
    expect(reparseUnchangedTable(`New\n${source}`, expected)).toBeNull();
  });
});
