import { describe, expect, it } from "vitest";

import {
  buildBasePromotionPlan,
  embeddedBaseSource,
  promotionBlockAt,
  promotionBlocks,
  RECORD_ID_PROPERTY,
  TABLE_MEMBERSHIP_PROPERTY,
} from "../src/core/base-promotion";
import { parseEditableTables } from "../src/core/parser";

function table(source: string) {
  const parsed = parseEditableTables(source).tables[0];
  if (parsed === undefined) throw new Error("Expected a table fixture.");
  return parsed;
}

describe("Base promotion planning", () => {
  it("creates stable unique property keys and path-independent record metadata", () => {
    const source = `| Name | Due Date | Due-Date | structural table ids |
| --- | --- | --- | --- |
| Alice | 2026-09-01 | Soon | Team |`;
    const plan = buildBasePromotionPlan(table(source), "stb_123", ["str_1"]);
    expect(plan.columns.map((column) => column.key)).toEqual([
      "name",
      "due_date",
      "due_date_2",
      `${TABLE_MEMBERSHIP_PROPERTY}_2`,
    ]);
    expect(plan.records[0]).toEqual({
      recordId: "str_1",
      fileStem: "Alice",
      values: {
        name: "Alice",
        due_date: "2026-09-01",
        due_date_2: "Soon",
        [`${TABLE_MEMBERSHIP_PROPERTY}_2`]: "Team",
      },
    });
    expect(RECORD_ID_PROPERTY).toBe("structural_record_id");
  });

  it("uses Windows-safe readable filename candidates", () => {
    const source = `| Name | Value |
| --- | --- |
| CON | 1 |
| A/B:*? | 2 |`;
    const plan = buildBasePromotionPlan(table(source), "stb_files", ["str_1", "str_2"]);
    expect(plan.records.map((record) => record.fileStem)).toEqual(["_CON", "A B"]);
  });

  it("describes structural flattening and blocks merged data cells", () => {
    const rowHeaders = table(`| Region | Value |
| --- || --- |
| North | 1 |
| ^ | 2 |`);
    const plan = buildBasePromotionPlan(rowHeaders, "stb_rows", ["str_1", "str_2"]);
    expect(plan.records.map((record) => record.values.region)).toEqual(["North", "North"]);
    expect(plan.warnings).toEqual([
      "row-headers-become-properties",
      "repeat-row-headers",
    ]);
    expect(plan.blockers).toEqual([]);

    const dataMerge = table(`| Name | Q1 | Q2 |
| --- | --- | --- |
| Alice | 1 | < |`);
    expect(buildBasePromotionPlan(dataMerge, "stb_data", ["str_1"]).blockers).toEqual([{
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
    const plan = buildBasePromotionPlan(structural, "stb_headers", ["str_1"]);
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
    const plan = buildBasePromotionPlan(table(source), "stb_abc", ["str_abc"]);
    const base = embeddedBaseSource(plan, "People/_structural-table-records/stb_abc/_promotion.json");
    expect(base).toContain("# structural-tables-promotion: stb_abc");
    expect(base).toContain('list(note.structural_table_ids).contains("stb_abc")');
    expect(base).toContain("  姓名:\n    displayName: \"姓名\"");
    expect(base).toContain("      - note.due_date");
  });

  it("finds only plugin-owned Base blocks at the cursor", () => {
    const plan = buildBasePromotionPlan(table(`| Name | Value |
| --- | --- |
| A | 1 |`), "stb_find", ["str_1"]);
    const block = embeddedBaseSource(plan, "Folder/_promotion.json");
    const note = `Before\n\n${block}\n\nAfter`;
    const inside = note.indexOf("filters:");
    expect(promotionBlockAt(note, inside)).toMatchObject({
      tableId: "stb_find",
      manifestPath: "Folder/_promotion.json",
      propertyKeys: ["name", "value"],
      source: block,
    });
    expect(promotionBlockAt(note, 0)).toBeNull();
    expect(promotionBlockAt("```base\nfilters: []\n```", 10)).toBeNull();
  });

  it("lists every valid plugin-owned Base block without accepting lookalikes", () => {
    const first = embeddedBaseSource(
      buildBasePromotionPlan(table(`| Name |\n| --- |\n| A |`), "stb_first", ["str_1"]),
      "Folder/first.json",
    );
    const second = embeddedBaseSource(
      buildBasePromotionPlan(table(`| Value |\n| --- |\n| 1 |`), "stb_second", ["str_2"]),
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
});
