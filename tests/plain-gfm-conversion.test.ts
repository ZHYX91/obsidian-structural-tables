import MarkdownIt from "markdown-it";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { parseEditableTables } from "../src/core/parser";
import { planPlainGfmConversion, plainGfmConversionInDocument } from "../src/core/plain-gfm-conversion";
import { mayUsePipeReferences } from "../src/core/portable-markdown-cell";
import { withSourcePrefix } from "../src/core/source-lines";

const ROW_HEADERS = "| --- || --- | --- |\n| 姓名 | 张三 | 李四 |\n| 年龄 | 28 | 31 |\n| 城市 | 杭州 | 上海 |";
const table = (source: string) => parseEditableTables(source).tables[0]!;
const rendered = (source: string) => new JSDOM(new MarkdownIt({ html: true }).render(source)).window.document;

describe("plain GFM conversion plans", () => {
  it.each([
    ["unmatched backtick run", "``A\\|B `sum`"],
    ["a real code span after an unmatched run", "``example `a|b`"],
    ["escaped backtick next to a code opener", "\\``a|b`"],
    ["link destination", "[Guide](docs/`A\\|B`.md)"],
    ["angle-bracketed image destination", "![alt](<pic/`A\\|B`.png>)"],
    ["link title and visible code label", "[`a|b`](file.md 'Run `x\\|y`')"],
    ["parenthesized title", "[Guide](file.md (Run `x\\|y`))"],
    ["relative HTML link destination", "<a href='docs/`a|b`.md'>Guide</a>"],
    ["HTML image attributes", "<img src='pics/`A|B`.png' alt='one &amp; `two|three`' title='x > y'>"],
    ["autolink inside a link label", "[<https://example.org/`a|b`>](guide)"],
    ["autolink inside an image label", "![Guide <https://example.org/`a|b`>](pic.png)"],
    ["HTML source inside an image label", "![<span title='`a|b`'>x</span>](pic.png)"],
    ["URI autolink", "<https://example.org/`a|b`?a=1&b=2>"],
    ["email autolink", "<`a|b`@example.org>"],
    ["unquoted HTML attribute", "<span data-label=A\\|B>text</span>"],
    ["attribute with authored backslash and adjacent code", "<a href='docs/`a\\|b`.md'>`a|b`</a>"],
    ["HTML attribute", "<span title='Run `x|y`'>text</span>"],
    ["unclosed link remains prose", "[Guide](broken `a|b`"],
  ] as const)("preserves %s on document replacement", (_name, cell) => {
    const source = "| First | Next |\n| --- || --- |\n| " + cell + " | **keep** |";
    const result = plainGfmConversionInDocument(source, table(source), "keep");
    expect(result.changed).toBe(true);
    const cells = rendered(result.source).querySelectorAll("td");
    const markdown = new MarkdownIt({ html: true });
    const expected = cells[0]!.ownerDocument.createElement("td");
    expected.innerHTML = markdown.renderInline(cell);
    expect(cells[0]!.innerHTML).toBe(expected.innerHTML);
    const native = expected.ownerDocument.createElement("td");
    native.innerHTML = markdown.renderInline(table(result.source).rows[1]!.cells[0]!.content);
    expect(native.innerHTML).toBe(expected.innerHTML);
    expect(cells[1]!.innerHTML).toBe("<strong>keep</strong>");
  });

  it("keeps an independent reference label when exporting HTML attributes or autolinks", () => {
    const cell = "[<span title='`a|b`'>link</span>][stable] and ![<https://site.org/`a|b`>][image]";
    const note = "| Header | Next |\n| --- || --- |\n| " + cell + " | keep |\n\n[stable]: note\n[image]: img.png";
    const result = plainGfmConversionInDocument(note, table(note), "keep");
    expect(result.source).toContain("][stable]");
    expect(result.source).toContain("][image]");
    const markdown = new MarkdownIt({ html: true });
    const env = {};
    const definitions = note.slice(note.indexOf("\n\n"));
    markdown.parse(definitions, env);
    const expected = new JSDOM(markdown.renderInline(cell, env)).window.document.body.innerHTML;
    expect(rendered(result.source + definitions).querySelector("td")?.innerHTML).toBe(expected);
    const native = table(result.source).rows[1]!.cells[0]!.content;
    expect(new JSDOM(markdown.renderInline(native, env)).window.document.body.innerHTML).toBe(expected);
  });

  it("preserves an opaque full reference identifier whose HTML attribute contains code-looking text", () => {
    const id = "<span title='`a\\|b`'>";
    const definitions = "\n\n[" + id + "]: note\n[" + id.replace("\\|", "|") + "]: note";
    const cell = "[Guide][" + id + "]";
    const note = "| H | K |\n| --- || --- |\n| " + cell + " | keep |" + definitions;
    const result = plainGfmConversionInDocument(note, table(note), "keep");
    expect(result.source).toContain(cell);
    expect(rendered(result.source + definitions).querySelector("td a")?.getAttribute("href")).toBe("note");
  });

  it.each(["", "\\", "\\\\", "\\\\\\"])("preserves document reference links and images with %j before the pipe", (slashes) => {
    const label = "`a" + slashes + "|b`";
    const definition = "[" + label + "]: <folder/guide (1)?a=1&amp;amp;b=2> 'It said &quot;yes&quot; | &amp;amp; ok'";
    const md = new MarkdownIt({ html: true });
    const env = {};
    md.parse(definition, env);
    for (const cell of ["[Guide][" + label + "]", "[" + label + "][]", "[" + label + "]",
      "![Photo][" + label + "]", "![" + label + "][]", "![" + label + "]"]) {
      const source = "| H | K |\n| --- || --- |\n| " + cell + " | keep |\n\n" + definition;
      const result = plainGfmConversionInDocument(source, table(source), "keep");
      expect(result.changed).toBe(true);
      const reference = new JSDOM(md.renderInline(cell, env)).window.document.body;
      const expected = reference.querySelector("a, img")!;
      expect(expected).not.toBeNull();
      const cells = rendered(result.source).querySelectorAll("td");
      expect(cells).toHaveLength(2);
      expect(cells[0]!.innerHTML).toBe(reference.innerHTML);
      expect(cells[1]!.textContent).toBe("keep");
      const nativeCell = table(result.source).rows[1]!.cells[0]!.content;
      expect(new JSDOM(md.renderInline(nativeCell)).window.document.body.innerHTML).toBe(reference.innerHTML);
    }
  });

  it("keeps ordinary reference spelling and treats a literal or undefined definition as prose", () => {
    const cell = "[Guide][`a|b`] [ordinary][note] [`x|y`](guide)";
    const source = "| H | K |\n| --- || --- |\n| " + cell + " | keep |\n\n```\n[`a|b`]: hidden\n```\n\n[note]: elsewhere";
    const plan = planPlainGfmConversion(table(source), source)!.keep.source;
    expect(plan).toContain("[ordinary][note]");
    expect(plan).toContain("[Guide][<code>");
    const td = rendered(plan).querySelector("td")!;
    expect(td.querySelectorAll("a")).toHaveLength(1);
    expect(td.querySelector("a code")?.textContent).toBe("x|y");
    expect(td.querySelector("a")?.getAttribute("href")).toBe("guide");
  });

  it("resolves the first owned multiline container definition and skips literal examples", () => {
    const cell = "[Guide][`a|b`]";
    const source = "---\nexample: 1\n[`a|b`]: frontmatter\n---\n\n| H | K |\n| --- || --- |\n| " + cell + " | keep |"
      + "\n\n%%\n[`a|b`]: comment\n%%\n\n> - [`a|b`]:\n>   <folder/my guide>\n>   'from the list'\n\n[`a|b`]: later";
    const projected = planPlainGfmConversion(table(source), source)!.keep.source;
    const link = rendered(projected).querySelector("a")!;
    expect(link.getAttribute("href")).toBe("folder/my%20guide");
    expect(link.getAttribute("title")).toBe("from the list");
    expect(planPlainGfmConversion(table(source))!.keep.source).toContain("[Guide][<code>");
  });

  it("skips the note reference scan when piped code follows a link", () => {
    const source = "| H | K |\n| --- || --- |\n| [Guide](location) and `a|b` | keep |\n\n[unused]: elsewhere";
    expect(mayUsePipeReferences(table(source))).toBe(false);
    expect(planPlainGfmConversion(table(source), source)!.keep.source).toContain("<code>");
  });

  it("keeps native inline code after an unmatched backtick run", () => {
    const cell = "``example `a|b`";
    const source = "| First | Next |\n| --- || --- |\n| " + cell + " | Keep |";
    const result = plainGfmConversionInDocument(source, table(source), "keep");
    const exportedCell = table(result.source).rows[1]!.cells[0]!.content;
    const markdown = new MarkdownIt({ html: true });
    expect(markdown.renderInline(exportedCell)).toBe(markdown.renderInline(cell));
  });

  it("preserves a literal vertical tab inside piped code when replacing a table with GFM", () => {
    const value = "A\vB|C";
    const source = "| Code | Next |\n| --- || --- |\n| `" + value + "` | **keep** |";
    const result = plainGfmConversionInDocument(source, table(source), "keep");
    expect(result.changed).toBe(true);
    const doc = rendered(result.source);
    expect(doc.querySelector("td code")?.textContent).toBe(value);
    expect(doc.querySelector("td strong")?.textContent).toBe("keep");
  });

  it("recommends transposing only row headers, with real GFM header semantics and an explicit keep option", () => {
    const conversion = planPlainGfmConversion(table(ROW_HEADERS))!;
    expect(conversion.recommended).toBe("transpose");
    expect(conversion.transpose!.warnings).toEqual([]);
    expect([...rendered(conversion.transpose!.source).querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["姓名", "年龄", "城市"]);
    expect([...rendered(conversion.transpose!.source).querySelectorAll("td")].map((cell) => cell.textContent)).toEqual(["张三", "28", "杭州", "李四", "31", "上海"]);
    expect([...rendered(conversion.keep.source).querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["", "", ""]);
    expect(conversion.keep.warnings).toEqual(["row-headers", "empty-header"]);
    expect(conversion.keep.source).toContain("| 姓名  | 张三  | 李四  |");
    expect(table(conversion.transpose!.source)).toMatchObject({ valid: true, structural: false, headerRowCount: 1, rowHeaderColumnCount: 0 });
  });

  it("explains collapsed header levels and repeated merged cells in both orientations", () => {
    const source = "| Region | Sales | < |\n| Quarter | Q1 | Q2 |\n| --- || --- | --- |\n| North | 10 | 12 |\n| ^ | 8 | 11 |";
    const conversion = planPlainGfmConversion(table(source))!;
    expect(conversion.recommended).toBe("keep");
    expect(conversion.keep.warnings).toEqual(["merged-cells", "multiple-headers", "row-headers"]);
    expect(conversion.keep.source).toContain("| Region / Quarter | Sales / Q1 | Sales / Q2 |");
    expect(conversion.keep.source).toContain("| North            | 8          | 11         |");
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
    const again = plainGfmConversionInDocument(conversion.keep.source, table(conversion.keep.source), "keep");
    expect(again).toMatchObject({ changed: false, source: conversion.keep.source });
    expect(rendered(conversion.keep.source).querySelectorAll("tbody tr")).toHaveLength(2);
    expect(conversion.transpose!.warnings).toEqual(["empty-header"]);
  });

  it("keeps an untransposable all-header table available for ordinary export", () => {
    const conversion = planPlainGfmConversion(table("| A | B |\n| --- | --- |"))!;
    expect(conversion.transpose).toBeNull();
    expect(conversion.keep.source).toBe("| A   | B   |\n| --- | --- |");
  });

  it("explains alignment reset only when choosing a transpose with mixed column alignment", () => {
    const conversion = planPlainGfmConversion(table("| ---: || :--- |\n| Name | Alice |\n| Age | 28 |"))!;
    expect(conversion.transpose!.warnings).toContain("alignment");
    expect(conversion.keep.warnings).not.toContain("alignment");
    expect(conversion.keep.source).toContain("| ---: | :---- |");
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
