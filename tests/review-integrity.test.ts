import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { editCellContent, editCellAndAppendRow } from "../src/core/operations";
import { parseEditableTables } from "../src/core/parser";
import { importedHtmlTableToStructuralSource } from "../src/core/interchange";
import { migrateMembershipFilter, migrateLegacyPromotionBlocks } from "../src/core/base-promotion";

describe("reviewed write and container integrity", () => {
  it("finds legacy view filters in an owned Base whose global filter is current", () => {
    const source = '```base\nstructural-tables:\n  version: 1\n  tableId: stb_people\n  manifestPath: Records/_promotion.json\nfilters: \'list(note["structural-tables"]).contains("stb_people")\'\nviews:\n  - type: table\n    name: People\n    filters: \'list(note.structural_table_ids).contains("stb_people")\'\n```';
    const migrated = migrateLegacyPromotionBlocks(source);
    expect(migrated.count).toBe(1);
    expect(migrated.source).not.toContain("note.structural_table_ids");
    expect(migrateLegacyPromotionBlocks(migrated.source).count).toBe(0);
    expect(migrateLegacyPromotionBlocks(source.replace("structural-tables:\n  version: 1\n  tableId: stb_people\n  manifestPath: Records/_promotion.json\n", "")).count).toBe(0);
  });
  it.each([['- - -', 6], ['* * *', 6], ['- * * *', 8], ['- - - -', 8]] as const)("keeps code after thematic breaks protected: %s", (opening, indent) => {
    const source = [opening, "", ...['| A | < |', '| --- | --- |', '| x | y |'].map(line => " ".repeat(indent) + line)].join("\n");
    expect(parseEditableTables(source).tables).toHaveLength(0);
  });
  it("still protects real same-line nested list fences", () => {
    const source = '- - ~~~md\n    | A | < |\n    | --- | --- |\n    | x | y |\n    ~~~\n\n| Real | V |\n| --- | --- |\n| x | y |';
    expect(parseEditableTables(source).tables.map(table => table.rows[0]!.cells[0]!.content)).toEqual(["Real"]);
  });
  const source = "| H | V |\n| --- || --- |\n| A | KEEP-1 |\n| B | KEEP-2 |\n| C | KEEP-3 |";
  it.each(["<!--", "%%"].flatMap(input => [1, 2, 3].map(row => ({ input, row }))))("refuses truncated edit $input in row $row", ({ input, row }) => {
    const table = parseEditableTables(source).tables[0]!;
    for (const operation of [editCellContent, editCellAndAppendRow]) {
      expect(operation(table, row, 0, input)).toMatchObject({ changed: false, source, code: "invalid-result" });
    }
  });
  it.each(["<!--", "%%"])("refuses truncated imported table: %s", text => {
    const rows = [["H", "V"], [text, "KEEP-1"], ["B", "KEEP-2"]].map((cells, i) => ({
      section: i === 0 ? "head" as const : "body" as const,
      cells: cells.map(text => ({ text, rowSpan: 1, columnSpan: 1, header: i === 0 })),
    }));
    expect(importedHtmlTableToStructuralSource(rows)).toBeNull();
  });
  it("migrates global and view filters while preserving other strings", () => {
    const source = 'filters: list(note.structural_table_ids).contains("id")\nviews:\n  - type: table\n    name: list(note.structural_table_ids)\n    filters:\n      or:\n        - list(note.structural_table_ids).contains("id")\n        - \'"list(note.structural_table_ids)" == "literal"\'\n';
    const value = parseDocument(migrateMembershipFilter(source)).toJS();
    expect(value.filters).toBe('list(note["structural-tables"]).contains("id")');
    expect(value.views[0].filters.or[0]).toBe(value.filters);
    expect(value.views[0].filters.or[1]).toBe('"list(note.structural_table_ids)" == "literal"');
    expect(value.views[0].name).toBe('list(note.structural_table_ids)');
  });
  it.each(["|", ">", "|-", "|+", ">-", ">+"].flatMap(style => ["\n", "\r\n", "\r"].map(ending => ({ style, ending }))))("preserves block scalar value $style / $ending", ({ style, ending }) => {
    const source = [`filters: ${style} # keep`, '  list(note.structural_table_ids)', '  .contains("id")', '', 'views: []'].join(ending);
    const before = parseDocument(source.replace(/\r\n|\r/gu, "\n")).toJS();
    const migrated = migrateMembershipFilter(source);
    const after = parseDocument(migrated.replace(/\r\n|\r/gu, "\n")).toJS();
    expect(after.filters).toBe(before.filters.replace('note.structural_table_ids', 'note["structural-tables"]'));
    expect(migrated).toContain('# keep');
    expect(migrateMembershipFilter(migrated)).toBe(migrated);
  });
  it("protects a fence beginning on a list marker line", () => {
    const source = '- ~~~markdown\n  | A | < |\n  | --- | --- |\n  | x | y |\n  ~~~';
    expect(parseEditableTables(source).tables).toHaveLength(0);
  });
  it("ends an unclosed fence at its list container boundary", () => {
    const source = '- item\n  ~~~markdown\n  example\n\n| A | B |\n| --- | --- |\n| x | y |';
    expect(parseEditableTables(source).tables).toHaveLength(1);
  });
  it.each(["<!-- closed -->", "%% closed %%", "`<!--`", "`%%`"])("preserves complete safe edits containing %s", input => {
    const result = editCellContent(parseEditableTables(source).tables[0]!, 2, 0, input);
    expect(result.changed).toBe(true);
    const parsed = parseEditableTables(result.source).tables[0]!;
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows[2]!.cells[0]!.content).toBe(input);
    expect(result.source).toContain("KEEP-3");
  });
  it.each(["", "> ", "> > "])("contains nested list fences within quoted scope %s", prefix => {
    const lines = ['- item', '  - ~~~md', '    | Fake | < |', '    | --- | --- |', '    | x | y |', '', '  | Real | V |', '  | --- | --- |', '  | x | y |', '', '| Outside | V |', '| --- | --- |', '| x | y |'];
    const tables = parseEditableTables(lines.map(line => prefix + line).join("\n")).tables;
    expect(tables).toHaveLength(2);
    expect(tables.map(table => table.rows[0]!.cells[0]!.content)).toEqual(["Real", "Outside"]);
  });
});
