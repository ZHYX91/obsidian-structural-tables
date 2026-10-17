import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { parseEditableTables, parseStructuralTables } from "../src/core/parser";
import { serializeStructuralTable } from "../src/core/serializer";
import { cellColumnAt, editCellContent, insertTableRow, splitCell } from "../src/core/operations";
import { withSourcePrefix } from "../src/core/source-lines";
import { buildBasePromotionPlan } from "../src/core/base-promotion";

const tableSource = "| A | < |\n| --- | --- |\n| x | y |";

describe("source containers", () => {
  it.each(['<widget title="a > b">', "<widget title='a < b'>", "<widget enabled value=plain />", "</widget >"])(
    "keeps valid standalone HTML literal: %s", (tag) => {
      const source = `${tag}\n${tableSource}`;
      expect(new MarkdownIt({ html: true }).parse(source, {}).some((token) => token.type === "html_block")).toBe(true);
      expect(parseEditableTables(source).tables).toEqual([]);
    },
  );
  it.each(["<widget =broken>", "</widget invalid>", "<widget title=\"unterminated>"])(
    "does not hide a table after malformed HTML: %s", (tag) => {
      const source = `${tag}\n${tableSource}`;
      expect(new MarkdownIt({ html: true }).parse(source, {}).some((token) => token.type === "html_block")).toBe(false);
      expect(parseEditableTables(source).tables).toHaveLength(1);
    },
  );
  it.each(["<div>", "<?instruction", "<![CDATA["])("keeps quoted fence text inside literal HTML: %s", (tag) => {
    expect(parseEditableTables(`${tag}\n> \`\`\`\n${tableSource}`).tables).toEqual([]);
  });
  it.each([
    ["# Heading", true],
    ["## Heading ##", true],
    ["***", true],
    ["---", true],
    ["~~~md\nexample\n~~~", true],
    ["```md\nexample\n```", true],
    ["Title\n===", true],
    ["Normal paragraph", false],
    ["A **continued** paragraph", false],
  ] as const)("compares CommonMark type-7 ownership after %s", (before, ownsHtml) => {
    const literal = ['<span id="literal" class="keep">', ...tableSource.split("\n"), "</span>"].join("\n");
    const source = before + "\n" + literal + "\n\n" + tableSource;
    const startsHtml = new MarkdownIt({ html: true }).parse(source, {}).some((token) =>
      token.type === "html_block" && token.content.includes('<span id="literal"'));
    expect(startsHtml).toBe(ownsHtml);
    const tables = parseEditableTables(source).tables;
    expect(tables.some((table) => table.source.includes("| A | < |"))).toBe(!ownsHtml);
    expect(tables.some((table) => table.source === tableSource)).toBe(true);
  });

  it.each([
    ["> # Heading\n> <span id='literal'>", "> "],
    ["- # Heading\n  <span id='literal'>", "  "],
    ["> Paragraph\n> <span id='literal'>", "> "],
    ["- Paragraph\n  <span id='literal'>", "  "],
  ] as const)("keeps type-7 ownership scoped to the quote/list container: %s", (head, prefix) => {
    const nested = ["| H | < |", "| --- | --- |", "| a | b |", "</span>"]
      .map((line) => prefix + line).join("\n");
    const source = head + "\n" + nested + "\n\n" + tableSource;
    const tables = parseEditableTables(source).tables;
    expect(tables.some((table) => table.source.includes("| H | < |"))).toBe(!head.includes("Heading"));
    expect(tables.some((table) => table.source === tableSource)).toBe(true);
  });

  it("refuses nested Base promotion before producing files or replacement source", () => {
    const table = parseStructuralTables(withSourcePrefix(tableSource, "> ")).tables[0]!;
    expect(() => buildBasePromotionPlan(table, "example")).toThrow("outside its Markdown container");
  });
  it.each(["\n", "\r\n", "\r"])("preserves source offsets and terminators %j", (ending) => {
    const source = `Intro${ending}${ending}${tableSource.replace(/\n/gu, ending)}${ending}End`;
    const table = parseStructuralTables(source).tables[0]!;
    expect(table.valid).toBe(true);
    expect(source.slice(table.range.from, table.range.to)).toBe(tableSource.replace(/\n/gu, ending));
    const result = editCellContent(table, 1, 0, "changed");
    expect(result.changed).toBe(true);
    expect(parseStructuralTables(result.source).tables[0]?.rows[1]?.cells[0]?.content).toBe("changed");
    expect(result.source.split(ending)).toHaveLength(3);
    expect(source.slice(table.range.to)).toBe(`${ending}End`);
  });

  it.each(["> ", ">> ", "> > ", "  ", "   "])("preserves %j through formatting and edits", (prefix) => {
    const source = withSourcePrefix(tableSource, prefix);
    const table = parseStructuralTables(source).tables[0]!;
    expect(table.valid).toBe(true);
    for (const result of [serializeStructuralTable(table), editCellContent(table, 1, 0, "changed").source,
      insertTableRow(table, 1, "after").source, splitCell(table, 0, 0).source]) {
      expect(result.split("\n").every((line) => line.startsWith(prefix + "|"))).toBe(true);
    }
    expect(cellColumnAt(prefix + "| A | B |", prefix.length + 3)).toBe(0);
    expect(cellColumnAt(prefix + "| A | B |", prefix.length + 7)).toBe(1);
  });

  it("recognizes indented list continuations but excludes their code blocks", () => {
    const source = "- outer\n  - inner\n\n" + withSourcePrefix(tableSource, "    ");
    const table = parseStructuralTables(source).tables[0]!;
    expect(table.sourcePrefix).toBe("    ");
    const result = editCellContent(table, 1, 0, "changed");
    expect(result.changed).toBe(true);
    expect(parseStructuralTables(source.slice(0, table.range.from) + result.source).tables[0]?.valid).toBe(true);
    expect(parseStructuralTables("- outer\n\n" + withSourcePrefix(tableSource, "      ")).tables).toEqual([]);
    expect(parseStructuralTables(withSourcePrefix(tableSource, "    ")).tables).toEqual([]);
  });

  it.each(["---", "..."])("ignores an indented YAML scalar delimiter %s", (delimiter) => {
    const source = `---\nexample: |\n  ${delimiter}\n${withSourcePrefix(tableSource, "  ")}\n---\n\n${tableSource}`;
    const tables = parseStructuralTables(source).tables;
    expect(tables).toHaveLength(1);
    expect(tables[0]?.startLine).toBe(8);
  });

  it.each(["> ", ">> ", "  "])("excludes fences inside %j", (prefix) => {
    expect(parseStructuralTables(withSourcePrefix("```md\n" + tableSource + "\n```", prefix)).tables).toEqual([]);
  });

  it.each(["```", "~~~"])("keeps a fence opened after a list marker and quote protected: %s", (fence) => {
    const source = [
      `- > ${fence}md`,
      "  > | Fake | < |",
      "  > | --- | --- |",
      "  > | x | y |",
      `  > ${fence}`,
      "",
      "| Real | < |",
      "| --- | --- |",
      "| x | y |",
    ].join("\n");
    const tables = parseStructuralTables(source).tables;
    expect(tables).toHaveLength(1);
    expect(tables[0]?.rows[0]?.cells[0]?.content).toBe("Real");
  });

  it("does not join rows across containers or leak quote fences", () => {
    const source = withSourcePrefix(tableSource, "> ") + "\n| outside | row |\n\n> ```md\n> code\n\n" + tableSource;
    const tables = parseStructuralTables(source).tables;
    expect(tables).toHaveLength(2);
    expect(tables[0]?.rows).toHaveLength(2);
    expect(tables[1]?.valid).toBe(true);
  });

  it("keeps quoted examples inside top-level and quoted fences protected", () => {
    expect(parseStructuralTables("```md\n> example\n" + tableSource + "\n```").tables).toEqual([]);
    expect(parseStructuralTables("> ```md\n> > example\n" + withSourcePrefix(tableSource, "> ") + "\n> ```").tables).toEqual([]);
  });

  it("treats deeper quote markers inside quoted raw HTML as literal content", () => {
    const source = [
      "> <pre>",
      "> > literal",
      "> | H | < |",
      "> | --- | --- |",
      "> | x | y |",
      "> </pre>",
      "",
      tableSource,
    ].join("\n");
    const tables = parseStructuralTables(source).tables;
    expect(tables).toHaveLength(1);
    expect(tables[0]?.source).toBe(tableSource);
  });

  it("does not let literal list markers inside root raw HTML create list indentation", () => {
    const structural = tableSource.split("\n").map((line) => `    ${line}`).join("\n");
    const ordinary = "| A | B |\n| --- | --- |\n| x | y |".split("\n")
      .map((line) => `    ${line}`).join("\n");
    expect(parseEditableTables(`<pre>\n- literal\n  </pre>\n\n${structural}`).tables).toEqual([]);
    expect(parseEditableTables(`<pre>\n- literal\n  </pre>\n\n${ordinary}`).tables).toEqual([]);
  });
  it("protects CommonMark type-6 closing tags until the next blank line", () => {
    const literal = ["</div>", "| Fake | V |", "| --- || --- |", "| x | y |"].join("\n");
    const note = literal + "\n\n" + tableSource;
    const tables = parseEditableTables(note).tables;
    expect(tables).toHaveLength(1);
    expect(tables[0]?.source).toBe(tableSource);
    expect(tables[0]?.range.from).toBe(literal.length + 2);
  });
  it.each(["base", "basefont", "frame", "frameset", "link", "menuitem", "noframes",
    "optgroup", "option", "param", "search", "title", "track"])(
    "protects CommonMark type-6 HTML <%s> until a blank line", (tag) => {
      const raw = [`<${tag} data-example="literal">`, "| Fake | Table |", "| --- || --- |", "| A | B |"].join("\n");
      const doc = raw + "\n\n" + tableSource;
      const tables = parseEditableTables(doc).tables;
      expect(tables).toHaveLength(1);
      expect(tables[0]?.source).toBe(tableSource);
      expect(tables[0]?.range.from).toBe(raw.length + 2);
    },
  );
  it.each(["a", "custom-widget", "Warning"])(
    "protects an isolated type-7 <%s> HTML block but not inline text", (tag) => {
      const raw = [`<${tag} data-example="literal">`, "| Fake | Table |", "| --- || --- |", "| A | B |"].join("\n");
      const note = raw + "\n\n" + tableSource;
      expect(parseEditableTables(note).tables.map((table) => table.source)).toEqual([tableSource]);
      const inline = `Ordinary prose\n<${tag}>\n` + tableSource;
      expect(parseEditableTables(inline).tables.some((table) => table.source.includes("| A | < |"))).toBe(true);
    },
  );
  it.each([["<?xml", "?>"], ["<!DOCTYPE", ">"], ["<![CDATA[", "]]>"]])(
    "protects HTML instruction/declaration/CDATA beginning with %s", (start, end) => {
      const raw = [start, "| Fake | Table |", "| --- || --- |", "| A | B |", end].join("\n");
      const doc = raw + "\n\n" + tableSource;
      expect(parseEditableTables(doc).tables.map((table) => table.source)).toEqual([tableSource]);
    },
  );
  it("does not treat pipe lines in raw HTML blocks as editable tables", () => {
    const html = ["<div id=\"literal\" class=\"keep-html\" style=\"color:red\">",
      "| H | V |", "| --- || --- |", "| x | y |", "</div>"].join("\n");
    const input = html + "\n\n" + tableSource;
    const parsed = parseEditableTables(input).tables;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.source).toBe(tableSource);
    expect(parsed[0]?.range.from).toBe(html.length + 2);
    expect(parseEditableTables(html).tables).toEqual([]);
  });

  it("preserves raw HTML ownership inside blockquotes and list continuations", () => {
    for (const prefix of ["> ", "    "]) {
      const container = prefix === "> " ? "" : "- List\n\n";
      const input = container + withSourcePrefix(
        "<div>\n| H | V |\n| --- || --- |\n| x | y |\n</div>", prefix
      ) + "\n\n" + tableSource;
      const parsed = parseEditableTables(input).tables;
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.source).toBe(tableSource);
    }
  });

});
