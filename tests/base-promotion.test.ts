import { describe, expect, it } from "vitest";

import {
  buildBasePromotionPlan,
  embeddedBaseSource,
  LEGACY_RECORD_ID_PROPERTY,
  LEGACY_TABLE_MEMBERSHIP_PROPERTY,
  migrateMembershipFilter,
  promotionBlockAt,
  promotionBlocks,
  TABLE_MEMBERSHIP_PROPERTY,
  tableMembershipState,
} from "../src/core/base-promotion";
import { parseEditableTables } from "../src/core/parser";

function table(source: string) {
  const parsed = parseEditableTables(source).tables[0];
  if (parsed === undefined) throw new Error("Expected a table fixture.");
  return parsed;
}

describe("Base promotion planning", () => {
  it("creates stable unique property keys and path-independent record metadata", () => {
    const source = `| Name | Due Date | due date | structural_table_ids |
| --- | --- | --- | --- |
| Alice | 2026-09-01 | Soon | Team |`;
    const plan = buildBasePromotionPlan(table(source), "stb_123");
    expect(plan.columns.map((column) => column.key)).toEqual([
      "Name",
      "Due Date",
      "due date_2",
      `${LEGACY_TABLE_MEMBERSHIP_PROPERTY}_2`,
    ]);
    expect(plan.records[0]).toEqual({
      fileStem: "Alice",
      values: {
        Name: "Alice",
        "Due Date": "2026-09-01",
        "due date_2": "Soon",
        [`${LEGACY_TABLE_MEMBERSHIP_PROPERTY}_2`]: "Team",
      },
    });
    expect(TABLE_MEMBERSHIP_PROPERTY).toBe("structural-tables");
  });

  it("preserves numeric and nonempty headers while naming only blank columns", () => {
    const source = `| 1 | 01 | 123 | １２３ | 1 | 123 Name |  |
| --- | --- | --- | --- | --- | --- | --- |
| A | B | C | D | E | F | G |`;
    const plan = buildBasePromotionPlan(table(source), "stb_numeric");

    expect(plan.columns.map((column) => column.key)).toEqual([
      "1",
      "01",
      "123",
      "１２３_2",
      "1_2",
      "123 Name",
      "column_7",
    ]);
    expect(plan.columns.map((column) => column.displayName)).toEqual([
      "1",
      "01",
      "123",
      "１２３",
      "1",
      "123 Name",
      "Column 7",
    ]);
    const base = embeddedBaseSource(plan, "Folder/numeric.json");
    expect(base).toContain('  "1":\n    displayName: "1"');
    expect(base).toContain('      - "note[\\"1\\"]"');
    expect(base).toContain('      - "note[\\"123 Name\\"]"');
  });

  it("quotes punctuation in preserved Property keys and reads it back", () => {
    const source = `| O'Reilly | a:b | bracket] |
| --- | --- | --- |
| A | B | C |`;
    const plan = buildBasePromotionPlan(table(source), "stb_punctuation");
    const base = embeddedBaseSource(plan, "Folder/punctuation.json");

    expect(base).toContain('  "a:b":\n    displayName: "a:b"');
    expect(base).toContain('      - "note[\\"O\'Reilly\\"]"');
    expect(promotionBlocks(base)[0]?.propertyKeys).toEqual(["O'Reilly", "a:b", "bracket]"]);
  });

  it("uses Windows-safe readable filename candidates", () => {
    const source = `| Name | Value |
| --- | --- |
| CON | 1 |
| A/B:*? | 2 |`;
    const plan = buildBasePromotionPlan(table(source), "stb_files");
    expect(plan.records.map((record) => record.fileStem)).toEqual(["_CON", "A B"]);
  });

  it("describes structural flattening and blocks merged data cells", () => {
    const rowHeaders = table(`| Region | Value |
| --- || --- |
| North | 1 |
| ^ | 2 |`);
    const plan = buildBasePromotionPlan(rowHeaders, "stb_rows");
    expect(plan.records.map((record) => record.values.Region)).toEqual(["North", "North"]);
    expect(plan.warnings).toEqual([
      "row-headers-become-properties",
      "repeat-row-headers",
    ]);
    expect(plan.blockers).toEqual([]);

    const dataMerge = table(`| Name | Q1 | Q2 |
| --- | --- | --- |
| Alice | 1 | < |`);
    expect(buildBasePromotionPlan(dataMerge, "stb_data").blockers).toEqual([{
      code: "merged-data-cell",
      row: 2,
      column: 2,
      rowSpan: 1,
      columnSpan: 2,
    }]);
  });

  it("lists multi-row and merged column-header flattening separately", () => {
    const structural = table(`| Year | < |
| Q1 | Q2 |
| --- | --- |
| 1 | 2 |`);
    const plan = buildBasePromotionPlan(structural, "stb_headers");
    expect(plan.columns.map((column) => column.displayName)).toEqual(["Year / Q1", "Year / Q2"]);
    expect(plan.warnings).toEqual([
      "flatten-multi-row-headers",
      "flatten-merged-column-headers",
    ]);
  });

  it("generates an embedded Base with membership filtering and display names", () => {
    const source = `| 姓名 | Due Date |
| --- | --- |
| Alice | Soon |`;
    const plan = buildBasePromotionPlan(table(source), "stb_abc");
    const base = embeddedBaseSource(plan, "People/_structural-table-records/stb_abc/_promotion.json");
    expect(base).toContain("# structural-tables-promotion: stb_abc");
    expect(base).toContain('list(note["structural-tables"]).contains("stb_abc")');
    expect(base).toContain("  \"姓名\":\n    displayName: \"姓名\"");
    expect(base).toContain('      - "note[\\"Due Date\\"]"');
  });

  it("finds only plugin-owned Base blocks at the cursor", () => {
    const plan = buildBasePromotionPlan(table(`| Name | Value |
| --- | --- |
| A | 1 |`), "stb_find");
    const block = embeddedBaseSource(plan, "Folder/_promotion.json");
    const note = `Before\n\n${block}\n\nAfter`;
    const inside = note.indexOf("filters:");
    expect(promotionBlockAt(note, inside)).toMatchObject({
      tableId: "stb_find",
      manifestPath: "Folder/_promotion.json",
      propertyKeys: ["Name", "Value"],
      source: block,
    });
    expect(promotionBlockAt(note, 0)).toBeNull();
    expect(promotionBlockAt("```base\nfilters: []\n```", 10)).toBeNull();
  });

  it("lists every valid plugin-owned Base block without accepting lookalikes", () => {
    const first = embeddedBaseSource(
      buildBasePromotionPlan(table(`| Name |\n| --- |\n| A |`), "stb_first"),
      "Folder/first.json",
    );
    const second = embeddedBaseSource(
      buildBasePromotionPlan(table(`| Value |\n| --- |\n| 1 |`), "stb_second"),
      "Folder/second.json",
    );
    const source = [
      "```base\n# structural-tables-promotion: stb_missing_manifest\nfilters: []\n```",
      first,
      "Text containing ```base is not a fenced block.",
      "```base\n# structural-tables-promotion: stb_bad\n# structural-tables-manifest: not-json\n```",
      second,
    ].join("\n\n");

    expect(promotionBlocks(source).map(({ tableId }) => tableId)).toEqual(["stb_first", "stb_second"]);
  });

  it("keeps plugin metadata recognizable after the user customizes a Base filter", () => {
    const source = `\`\`\`base
# structural-tables-promotion: stb_custom
# structural-tables-manifest: "Folder/custom.json"
filters:
  and:
    - 'note.status == "Active"'
\`\`\``;
    expect(promotionBlocks(source)[0]).toMatchObject({
      tableId: "stb_custom",
      membershipProperty: null,
    });
  });

  it("continues to read legacy dot-notation property orders", () => {
    const source = `\`\`\`base
# structural-tables-promotion: stb_legacy_order
# structural-tables-manifest: "Folder/legacy.json"
filters:
  and:
    - 'list(note.structural_table_ids).contains("stb_legacy_order")'
views:
  - type: table
    name: Table
    order:
      - note.name
      - note.value
\`\`\``;
    expect(promotionBlocks(source)[0]).toMatchObject({
      tableId: "stb_legacy_order",
      propertyKeys: ["name", "value"],
    });
  });

  it("reads current and legacy membership while rejecting invalid or conflicting dual values", () => {
    expect(tableMembershipState({ [TABLE_MEMBERSHIP_PROPERTY]: ["stb_one", "stb_two"] })).toEqual({
      status: "valid",
      ids: ["stb_one", "stb_two"],
    });
    expect(tableMembershipState({ [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_old"] })).toEqual({
      status: "valid",
      ids: ["stb_old"],
    });
    expect(tableMembershipState({
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_same"],
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_same"],
    }).status).toBe("valid");
    expect(tableMembershipState({
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_new"],
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_old"],
    }).status).toBe("conflict");
    expect(tableMembershipState({ [TABLE_MEMBERSHIP_PROPERTY]: "stb_scalar" }).status).toBe("invalid");
  });

  it("keeps legacy controls reserved and migrates only the membership filter", () => {
    const source = `filters:\n  and:\n    - 'list(note.${LEGACY_TABLE_MEMBERSHIP_PROPERTY}).contains("stb_old")'\n# ${LEGACY_RECORD_ID_PROPERTY}`;
    expect(migrateMembershipFilter(source)).toBe(
      `filters:\n  and:\n    - 'list(note["structural-tables"]).contains("stb_old")'\n# ${LEGACY_RECORD_ID_PROPERTY}`,
    );
  });
});
