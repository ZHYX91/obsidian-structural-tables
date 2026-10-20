import MarkdownIt from "markdown-it";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { parseEditableTables } from "../src/core/parser";
import { planPlainGfmConversion, plainGfmConversionInDocument } from "../src/core/plain-gfm-conversion";
import { withSourcePrefix } from "../src/core/source-lines";

const ROW_HEADERS = "| --- || --- | --- |\n| 姓名 | 张三 | 李四 |\n| 年龄 | 28 | 31 |\n| 城市 | 杭州 | 上海 |";
const table = (source: string) => parseEditableTables(source).tables[0]!;
const rendered = (source: string) => new JSDOM(new MarkdownIt({ html: true }).render(source)).window.document;

describe("plain GFM conversion plans", () => {
  it("recommends transposing only row headers, with real GFM header semantics and an explicit keep option", () => {
    const conversion = planPlainGfmConversion(table(ROW_HEADERS))!;
    expect(conversion.recommended).toBe("transpose");
    expect(conversion.transpose!.warnings).toEqual([]);
    expect([...rendered(conversion.transpose!.source).querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["姓名", "年龄", "城市"]);
    expect([...rendered(conversion.transpose!.source).querySelectorAll("td")].map((cell) => cell.textContent)).toEqual(["张三", "28", "杭州", "李四", "31", "上海"]);
    expect([...rendered(conversion.keep.source).querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["", "", ""]);
    expect(conversion.keep.warnings).toEqual(["row-headers", "empty-header"]);
    expect(conversion.keep.source).toContain("| 姓名 | 张三 | 李四 |");
    expect(table(conversion.transpose!.source)).toMatchObject({ valid: true, structural: false, headerRowCount: 1, rowHeaderColumnCount: 0 });
  });

  it("explains collapsed header levels and repeated merged cells in both orientations", () => {
    const source = "| Region | Sales | < |\n| Quarter | Q1 | Q2 |\n| --- || --- | --- |\n| North | 10 | 12 |\n| ^ | 8 | 11 |";
    const conversion = planPlainGfmConversion(table(source))!;
    expect(conversion.recommended).toBe("keep");
    expect(conversion.keep.warnings).toEqual(["merged-cells", "multiple-headers", "row-headers"]);
    expect(conversion.keep.source).toContain("| Region / Quarter | Sales / Q1 | Sales / Q2 |");
    expect(conversion.keep.source).toContain("| North | 8 | 11 |");
    expect(conversion.transpose!.warnings).toEqual(["merged-cells", "row-headers"]);
    expect(rendered(conversion.keep.source).querySelectorAll("[rowspan], [colspan]")).toHaveLength(0);
  });

  it("collapses two row-header columns after the recommended transpose", () => {
    const source = "| --- | --- || --- | --- |\n| 人物 | 姓名 | 张三 | 李四 |\n| ^ | 年龄 | 28 | 31 |\n| 地点 | 城市 | 杭州 | 上海 |";
    const conversion = planPlainGfmConversion(table(source))!;
    expect(conversion.recommended).toBe("transpose");
    expect(conversion.transpose!.warnings).toContain("multiple-headers");
    expect([...rendered(conversion.transpose!.source).querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["人物 / 姓名", "人物 / 年龄", "地点 / 城市"]);
  });

  it("adds an empty top header without promoting the first data row when there are no headers", () => {
    const conversion = planPlainGfmConversion(table("| --- | --- |\n| Alice | 10 |\n| Bob | 20 |"))!;
    expect(conversion.recommended).toBe("keep");
    expect(conversion.keep.warnings).toEqual(["empty-header"]);
    expect(rendered(conversion.keep.source).querySelectorAll("tbody tr")).toHaveLength(2);
    expect(conversion.transpose!.warnings).toEqual(["empty-header"]);
  });

  it("keeps an untransposable all-header table available for ordinary export", () => {
    const conversion = planPlainGfmConversion(table("| A | B |\n| --- | --- |"))!;
    expect(conversion.transpose).toBeNull();
    expect(conversion.keep.source).toBe("| A | B |\n| --- | --- |");
  });

  it("explains alignment reset only when choosing a transpose with mixed column alignment", () => {
    const conversion = planPlainGfmConversion(table("| ---: || :--- |\n| Name | Alice |\n| Age | 28 |"))!;
    expect(conversion.transpose!.warnings).toContain("alignment");
    expect(conversion.keep.warnings).not.toContain("alignment");
    expect(conversion.keep.source).toContain("| ---: | :--- |");
  });

  it("offers copy with an explicit hidden-cell warning but refuses replacement or transpose", () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 | hidden |";
    const conversion = planPlainGfmConversion(table(source))!;
    expect(conversion.keep.canReplace).toBe(false);
    expect(conversion.keep.warnings).toContain("hidden-cells");
    expect(conversion.transpose).toBeNull();
    expect(plainGfmConversionInDocument(source, table(source), "keep")).toMatchObject({ changed: false, code: "gfm-overflow-readonly", source });
  });

  it.each(["\n", "\r\n", "\r"])("preserves source line endings and container prefixes in one final write (%j)", (ending) => {
    const source = "> intro" + ending + ">" + ending + withSourcePrefix(ROW_HEADERS.replace(/\n/gu, ending), "> ") + ending + ">" + ending + "> after";
    const current = table(source);
    const plan = planPlainGfmConversion(current)!.transpose!;
    const result = plainGfmConversionInDocument(source, current, "transpose");
    expect(result.changed).toBe(true);
    expect(result.source).toBe(withSourcePrefix(plan.source, "> "));
    expect(result.source).toContain(ending);
    expect(table(source.slice(0, current.range.from) + result.source + source.slice(current.range.to))).toMatchObject({ valid: true, structural: false, sourcePrefix: "> " });
  });

  it.each([
    { name: "top-level", before: "", prefix: "" },
    { name: "list continuation", before: "- People\n\n", prefix: "    " },
    { name: "nested list continuation", before: "- Outer\n  - People\n\n", prefix: "      " },
  ].flatMap((container) => ["\n", "\r\n", "\r"].map((ending) => ({ ...container, ending }))))(
    "keeps the recommended header semantics inside $name with $ending line endings", ({ before, prefix, ending }) => {
      const neighbor = "| Keep | Source |\n| --- | --- |\n| A | B |".replace(/\n/gu, ending);
      const original = ROW_HEADERS.replace(/\n/gu, ending);
      const source = neighbor + ending + ending + before.replace(/\n/gu, ending)
        + withSourcePrefix(original, prefix) + ending + ending + neighbor;
      const current = parseEditableTables(source).tables[1]!;
      expect(current).toMatchObject({ valid: true, sourcePrefix: prefix, headerRowCount: 0, rowHeaderColumnCount: 1 });
      const conversion = planPlainGfmConversion(current)!;
      expect(conversion.recommended).toBe("transpose");
      expect(conversion.transpose).not.toBeNull();
      const candidate = conversion.transpose!.source;
      expect(candidate.match(/\r\n|\r|\n/gu)).toEqual([ending, ending, ending]);
      expect(table(candidate)).toMatchObject({ valid: true, structural: false, sourcePrefix: "", headerRowCount: 1 });
      expect([...rendered(candidate).querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["姓名", "年龄", "城市"]);

      const result = plainGfmConversionInDocument(source, current, "transpose");
      expect(result.changed).toBe(true);
      expect(result.source).toBe(withSourcePrefix(candidate, prefix));
      const updated = source.slice(0, current.range.from) + result.source + source.slice(current.range.to);
      const after = parseEditableTables(updated).tables;
      expect(after.map((entry) => entry.source)).toEqual([neighbor, result.source, neighbor]);
      expect(after[1]).toMatchObject({ valid: true, structural: false, sourcePrefix: prefix,
        range: { from: current.range.from, to: current.range.from + result.source.length } });
      const nativeTables = rendered(updated).querySelectorAll("table");
      expect(nativeTables).toHaveLength(3);
      expect([...nativeTables[1]!.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["姓名", "年龄", "城市"]);
      expect(nativeTables[1]!.closest("li") !== null).toBe(prefix !== "");
    },
  );

  it("rejects stale source and preserves both neighboring tables during replacement", () => {
    const neighbor = "| H | V |\n| --- | --- |\n| a | b |";
    const source = neighbor + "\n\n" + ROW_HEADERS + "\n\n" + neighbor;
    const current = parseEditableTables(source).tables[1]!;
    const stale = plainGfmConversionInDocument(source.replace("张三", "王五"), current, "transpose");
    expect(stale.changed).toBe(false);
    const result = plainGfmConversionInDocument(source, current, "transpose");
    expect(result.changed).toBe(true);
    const updated = source.slice(0, current.range.from) + result.source + source.slice(current.range.to);
    const after = parseEditableTables(updated).tables;
    expect(after.map((entry) => entry.source)).toEqual([neighbor, result.source, neighbor]);
    expect(after[1]!.range).toEqual({ from: current.range.from, to: current.range.from + result.source.length });
  });

  it("does not project malformed structural tables", () => {
    expect(planPlainGfmConversion(table("| A | B |\n| --- || --- |\n| 1 | 2 | 3 |"))).toBeNull();
  });
});
