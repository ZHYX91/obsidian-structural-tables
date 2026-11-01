// @vitest-environment happy-dom
import MarkdownIt from "markdown-it";
import { describe, expect, it, vi } from "vitest";
import * as cellSyntax from "../src/core/table-cell-syntax";
import { literalTableCellText, pasteLiteralCellText } from "../src/core/literal-cell-text";
import { parseEditableTables } from "../src/core/parser";

describe("literal cell text", () => {
  it.each(["[[Plan]]", "`hello`", "**bold**", "<!--VISIBLE-->", "<br>", "&copy;", "$x|y$", "<", "^",
    "😀 العربية", "\t before \u00a0\u202f\u2003", "one\ntwo", ...Array.from({ length: 8 }, (_, n) => "a" + "\\".repeat(n) + "|b")])(
    "preserves visible text and two columns: %j", (text) => {
      const raw = literalTableCellText(text)!;
      const source = `| H | V |\n| --- | --- |\n| ${raw} | KEEP |`;
      const parsed = parseEditableTables(source).tables[0]!;
      expect(parsed).toMatchObject({ valid: true, columnCount: 2 });
      const dom = new DOMParser().parseFromString(new MarkdownIt({ html: true }).render(source), "text/html");
      const cells = dom.querySelectorAll("td");
      expect(cells).toHaveLength(2);
      const cell = cells[0]!;
      cell.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      expect(cell.textContent).toBe(text);
      expect(cell.querySelector("a,code,em,strong,script")).toBeNull();
      expect(cells[1]!.textContent).toBe("KEEP");
    });

  it("supports consecutive pastes beside already encoded entities", () => {
    const first = pasteLiteralCellText("hello", 5, 5, " |")!;
    const second = pasteLiteralCellText(first, first.length, first.length, "[[next]]")!;
    const html = new MarkdownIt({ html: true }).renderInline(second);
    expect(new DOMParser().parseFromString(html, "text/html").body.textContent).toBe("hello |[[next]]");
    expect(pasteLiteralCellText(first, 7, 7, "x")).toBeNull();
  });

  it.each(["`code`", "$x$", "[label](path)", "<code>x</code>"])("refuses uncertain fragment contexts: %s", (raw) => {
    expect(pasteLiteralCellText(raw, 1, 1, "&copy;")).toBeNull();
    expect(pasteLiteralCellText(raw, 0, raw.length, "&copy;")).toBe("&#38;copy&#59;");
  });

  it.each(["Hello!", "foo_bar", "价格$5", "R&D", "**bold** tail"])("allows ordinary punctuation outside protected contexts: %s", (raw) => {
    expect(pasteLiteralCellText(raw, raw.length, raw.length, " +")).not.toBeNull();
  });

  it.each([
    ["[label](a(b)c)", 12], ['<span title="a>b">x</span>', 15], [String.raw`$x\$ y$`, 5],
    ["[[unfinished", 12], ['<span title="unfinished', 22], ["plain &amp; text", 8], [String.raw`[a\]b](path)`, 10], ["[a [b] c](path)", 12],
    ["<?pi target?>", 7], ["<![CDATA[a>b]]>", 11],
  ] as const)("protects complex or incomplete source context %s at %i", (raw, at) => {
    expect(pasteLiteralCellText(raw, at, at, "[[literal]]")).toBeNull();
  });

  it("protects Obsidian comment contents", () => {
    expect(pasteLiteralCellText("before %%hidden%% after", 12, 12, "|")).toBeNull();
    expect(pasteLiteralCellText("before %%hidden%% after", 23, 23, " literal")).not.toBeNull();
  });

  it("bounds unmatched delimiter scans at two input scales", () => {
    const scan = vi.spyOn(cellSyntax, "closedCodeSpanEnd");
    try {
      for (const size of [128, 4096]) {
        scan.mockClear();
        const code = "`".repeat(size) + "tail";
        expect(pasteLiteralCellText(code, code.length, code.length, "literal")).toBeNull();
        expect(scan).toHaveBeenCalledTimes(1);
        const bracket = "[".repeat(size) + "tail";
        expect(pasteLiteralCellText(bracket, bracket.length, bracket.length, "literal")).toBeNull();
        expect(scan).toHaveBeenCalledTimes(1);
      }
    } finally { scan.mockRestore(); }
  });

  it("refuses nonrepresentable controls and invalid offsets", () => {
    expect(literalTableCellText("a\0b")).toBeNull();
    expect(pasteLiteralCellText("a", -1, 1, "x")).toBeNull();
    expect(pasteLiteralCellText("a", 0, 2, "x")).toBeNull();
  });
});
