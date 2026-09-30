import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { analyzeBrRelatedContent } from "../src/core/base-promotion-content";
import { buildBasePromotionPlan } from "../src/core/base-promotion";
import { parseEditableTables, parseStructuralTables } from "../src/core/parser";

function table(source: string) {
  const parsed = parseEditableTables(source).tables[0];
  if (parsed === undefined) throw new Error("Expected table fixture.");
  return parsed;
}

describe("Base promotion br-related content reporting", () => {
  it("keeps the complete portable content fixture valid and promotable", () => {
    const source = readFileSync(new URL("../acceptance/fixtures/Base promotion content.md", import.meta.url), "utf8");
    const parsed = parseStructuralTables(source).tables;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.diagnostics).toEqual([]);
    expect(parsed[0]?.valid).toBe(true);
    const plan = buildBasePromotionPlan(parsed[0]!, "stb_content_fixture");
    expect(plan.blockers).toEqual([]);
    expect(plan.columns).toHaveLength(7);
    expect(plan.records).toHaveLength(4);
    expect(plan.contentReport.requiresAcceptance).toBe(true);
    expect(new Set(plan.contentReport.notices.flatMap((notice) => notice.occurrences.map(({ kind }) => kind))))
      .toEqual(new Set(["visual-break", "code-literal", "escaped-literal", "entity-literal", "math-uncertain", "html-uncertain"]));
    expect(plan.records[3]?.values.Code).toBe("``First<br>Second");
    expect(plan.records[3]?.values.HTML).toBe('<span title="`<br>`">value</span>');
  });

  it("reports supported visual breaks without changing planned headers or record values", () => {
    const source = [
      "| Label<br>Detail | Plain | Upper |",
      "| --- | --- | --- |",
      "| A | First<br>Second | First<BR/>Second |",
      "| B | First<br />Second | None |",
    ].join("\n");
    const plan = buildBasePromotionPlan(table(source), "stb_breaks");

    expect(plan.columns.map(({ key, displayName }) => ({ key, displayName }))).toEqual([
      { key: "Label<br>Detail", displayName: "Label<br>Detail" },
      { key: "Plain", displayName: "Plain" },
      { key: "Upper", displayName: "Upper" },
    ]);
    expect(plan.records.map(({ values }) => values)).toEqual([
      { "Label<br>Detail": "A", Plain: "First<br>Second", Upper: "First<BR/>Second" },
      { "Label<br>Detail": "B", Plain: "First<br />Second", Upper: "None" },
    ]);
    expect(plan.contentReport.requiresAcceptance).toBe(true);
    expect(plan.contentReport.notices.map((notice) => notice.occurrences.map(({ kind }) => kind))).toEqual([
      ["visual-break"],
      ["visual-break"],
      ["visual-break"],
      ["visual-break"],
    ]);
  });

  it("distinguishes code, escaped and entity literals from visual breaks", () => {
    const source = [
      "| Name | Value |",
      "| --- | --- |",
      "| Code | `First<br>Second` |",
      String.raw`| Escaped | \<br> |`,
      "| Entity | &lt;br&gt; |",
      String.raw`| Even slash | \\<br> |`,
      "| Unclosed tick | `prefix<br> |",
    ].join("\n");
    const plan = buildBasePromotionPlan(table(source), "stb_literals");
    const bySource = new Map(plan.contentReport.notices.map((notice) => [
      notice.source,
      notice.occurrences.map(({ kind }) => kind),
    ]));

    expect(bySource.get("`First<br>Second`")).toEqual(["code-literal"]);
    expect(bySource.get(String.raw`\<br>`)).toEqual(["escaped-literal"]);
    expect(bySource.get("&lt;br&gt;")).toEqual(["entity-literal"]);
    expect(bySource.get(String.raw`\\<br>`)).toEqual(["visual-break"]);
    expect(bySource.get("`prefix<br>")).toEqual(["visual-break"]);
  });

  it("keeps math and HTML contexts uncertain instead of guessing their presentation", () => {
    const source = [
      "| Name | Value |",
      "| --- | --- |",
      String.raw`| Math | $x+\text{<br>}$ |`,
      '| Attribute | <span title="<br>">x</span> |',
      "| Comment | <!-- <br> --> |",
      "| Raw | <pre><br></pre> |",
      "| Attr break | <br class=x> |",
      "| Spaced | <br > |",
    ].join("\n");
    const plan = buildBasePromotionPlan(table(source), "stb_uncertain");
    const kinds = new Map(plan.contentReport.notices.map((notice) => [
      notice.source,
      [...new Set(notice.occurrences.map(({ kind }) => kind))],
    ]));

    expect(kinds.get(String.raw`$x+\text{<br>}$`)).toEqual(["math-uncertain"]);
    expect(kinds.get('<span title="<br>">x</span>')).toEqual(["html-uncertain"]);
    expect(kinds.get("<!-- <br> -->")).toEqual(["html-uncertain"]);
    expect(kinds.get("<pre><br></pre>")).toEqual(["html-uncertain"]);
    expect(kinds.get("<br class=x>")).toEqual(["syntax-uncertain"]);
    expect(kinds.get("<br >")).toEqual(["syntax-uncertain"]);
  });

  it("does not report unrelated br-like text", () => {
    expect(analyzeBrRelatedContent("broad br <broad> &lt;broad&gt;")).toEqual([]);
    const plan = buildBasePromotionPlan(table("| Name | Value |\n| --- | --- |\n| A | broad |"), "stb_none");
    expect(plan.contentReport).toEqual({
      notices: [],
      sourceCellCount: 0,
      targetCount: 0,
      requiresAcceptance: false,
    });
  });

  it.each([
    ["``First<br>Second`", "visual-break"],
    ["`<pre>` First<br>Second", "visual-break"],
    ['<span title="`First<br>Second`">text</span>', "html-uncertain"],
    ["<!-- `<br>` -->", "html-uncertain"],
    [String.raw`\<pre> First<br>Second`, "visual-break"],
    ['<span title="$">First<br>Second</span>', "visual-break"],
    ['<span title="`">First<br>Second`', "visual-break"],
  ])("keeps context boundaries independent in %s", (source, kind) => {
    expect(analyzeBrRelatedContent(source).map((occurrence) => occurrence.kind)).toEqual([kind]);
  });

  it.each([
    ["$x+`<br>`$", ["math-uncertain"]],
    ["`$<br>$`", ["code-literal"]],
    ["`<!--` First<br>Second", ["visual-break"]],
    ["<!-- $ --> First<br>Second", ["visual-break"]],
    [String.raw`$\text{<pre>}<br>$ First<br>Last`, ["math-uncertain", "visual-break"]],
    ["$$x $ y<br>$$ Next<br>", ["math-uncertain", "visual-break"]],
  ])("keeps nested markers within their owning context in %s", (source, kinds) => {
    expect(analyzeBrRelatedContent(source).map((occurrence) => occurrence.kind)).toEqual(kinds);
  });

  it("reports final conflicting header keys and merged row-header fan-out without changing payloads", () => {
    const headers = buildBasePromotionPlan(table([
      "| A<br>B | a<br>b |",
      "| --- | --- |",
      "| one | two |",
    ].join("\n")), "stb_headers");
    expect(headers.columns.map(({ key }) => key)).toEqual(["A<br>B", "a<br>b_2"]);
    expect(headers.contentReport.notices.map((notice) => notice.targets)).toEqual([
      [{ type: "header", sourceColumn: 0, key: "A<br>B", displayName: "A<br>B" }],
      [{ type: "header", sourceColumn: 1, key: "a<br>b_2", displayName: "a<br>b" }],
    ]);

    const rowHeaders = buildBasePromotionPlan(table([
      "| Group | Value |",
      "| --- || --- |",
      "| First<br>Second | x |",
      "| ^ | y |",
    ].join("\n")), "stb_rows");
    expect(rowHeaders.records.map(({ values }) => values.Group)).toEqual(["First<br>Second", "First<br>Second"]);
    expect(rowHeaders.contentReport.sourceCellCount).toBe(1);
    expect(rowHeaders.contentReport.targetCount).toBe(2);
    expect(rowHeaders.contentReport.notices[0]?.targets).toEqual([
      { type: "record", recordIndex: 0, key: "Group", value: "First<br>Second" },
      { type: "record", recordIndex: 1, key: "Group", value: "First<br>Second" },
    ]);
  });
});
