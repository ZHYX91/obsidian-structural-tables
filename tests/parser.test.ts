import { describe, expect, it } from "vitest";

import { parseEditableTables, parseStructuralTables } from "../src/core/parser";

describe("parseStructuralTables", () => {
  it("does not take ownership of an ordinary GFM table", () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    expect(parseStructuralTables(source).tables).toEqual([]);
    expect(parseEditableTables(source).tables[0]).toMatchObject({
      structural: false,
      valid: true,
      headerRowCount: 1,
      columnCount: 2,
    });
  });

  it("rejects delimiter cells shorter than the GFM minimum", () => {
    const source = "| A | < |\n| - | -- |\n| 1 | 2 |";
    expect(parseStructuralTables(source).tables).toEqual([]);
    expect(parseEditableTables(source).tables).toEqual([]);
  });

  it("parses multi-row and row headers with rectangular merges", () => {
    const source = "| Region | Sales | < |\n| Quarter | Q1 | Q2 |\n| --- || --- | --- |\n| North | 10 | 12 |\n| ^ | 8 | 11 |";
    const table = parseStructuralTables(source).tables[0];
    expect(table).toMatchObject({ valid: true, headerRowCount: 2, rowHeaderColumnCount: 1, columnCount: 3 });
    expect(table?.rows[0]?.cells[0]).toMatchObject({ role: "corner_header" });
    expect(table?.rows[0]?.cells[1]).toMatchObject({ columnSpan: 2, role: "column_header" });
    expect(table?.rows[3]?.cells[0]).toMatchObject({ covered: true, anchorRow: 2, role: "row_header" });
  });

  it("treats escaped markers as literal content", () => {
    const source = String.raw`| Group | \< |
| Name | Value |
| --- | --- |
| A | \^ |`;
    const table = parseStructuralTables(source).tables[0];
    expect(table?.valid).toBe(true);
    expect(table?.rows[0]?.cells[1]?.content).toBe("<");
    expect(table?.rows[2]?.cells[1]?.content).toBe("^");
  });

  it("ignores structural-looking source in protected Markdown regions", () => {
    const source = "---\ntable: | --- || --- |\n---\n\n```md\n| A | < |\n| --- | --- |\n```\n\n    | A | < |\n    | --- | --- |";
    expect(parseStructuralTables(source).tables).toEqual([]);
  });

  it("recognizes BOM frontmatter and both YAML closing delimiters", () => {
    const bomSource = "\uFEFF---\nvalue: table\n| A | < |\n| --- | --- |\n---";
    const explicitEnd = "---\nvalue: table\n...\n| A | < |\n| --- | --- |";

    expect(parseStructuralTables(bomSource).tables).toEqual([]);
    expect(parseStructuralTables(explicitEnd).tables).toHaveLength(1);
    expect(parseStructuralTables(explicitEnd).tables[0]?.startLine).toBe(3);
  });

  it("requires a matching fence character and a closing run at least as long as the opening run", () => {
    const source = "````md\n```\n~~~\n| A | < |\n| --- | --- |\n````";
    expect(parseStructuralTables(source).tables).toEqual([]);
  });

  it("does not close a fence when the marker has trailing non-whitespace", () => {
    const source = "~~~md\n~~~ still-code\n| A | < |\n| --- | --- |\n~~~";
    expect(parseStructuralTables(source).tables).toEqual([]);
  });

  it("does not treat an indented marker or a backtick-bearing info string as a fence", () => {
    const source = "    ```md\n\n```bad`info\n| A | < |\n| --- | --- |";
    expect(parseStructuralTables(source).tables).toHaveLength(1);
  });

  it("records the source-table index when an ordinary GFM table comes first", () => {
    const source = "| Plain | Table |\n| --- | --- |\n| 1 | 2 |\n\n| A | < |\n| --- | --- |";
    expect(parseStructuralTables(source).tables[0]?.sourceTableIndex).toBe(1);
  });

  it("respects pipes in code spans and escaped pipes", () => {
    const source = "| Group | < |\n| `a|b` | a\\|b |\n| --- | --- |\n| X | Y |";
    const table = parseStructuralTables(source).tables[0];
    expect(table?.valid).toBe(true);
    expect(table?.columnCount).toBe(2);
  });

  it.each([
    ["missing anchor", "| < | B |\n| --- | --- |\n| 1 | 2 |", "merge-missing-anchor"],
    ["nonrectangle", "| A | < |\n| --- | --- |\n| ^ | B |", "merge-nonrectangular"],
    ["crossed role", "| A | B |\n| --- || --- |\n| ^ | 1 |", "merge-boundary"],
    ["multiple boundaries", "| A | B | C |\n| --- || --- || --- |\n| 1 | 2 | 3 |", "boundary-count"],
    ["edge boundary", "| A | B |\n|| --- | --- |\n| 1 | 2 |", "boundary-at-edge"],
    ["spaced boundary", "| A | B |\n| --- |  | --- |\n| 1 | 2 |", "boundary-token"],
    ["unequal width", "| A | B |\n| --- || --- |\n| 1 | 2 | 3 |", "row-width"],
    ["unequal header width", "| A | B | C |\n| --- || --- |\n| 1 | 2 |", "row-width"],
  ])("diagnoses %s", (_name, source, code) => {
    const table = parseStructuralTables(source).tables[0];
    expect(table?.valid).toBe(false);
    expect(table?.diagnostics.some((diagnostic) => diagnostic.code === code)).toBe(true);
    expect(table?.source).toBe(source);
  });
  it.each([
    ["Obsidian comments", ["%%", "| A | < |", "| --- | --- |", "| x | y |", "%%"].join("\n")],
    ["HTML comments", ["<!--", "| A | < |", "| --- | --- |", "| x | y |", "-->"].join("\n")],
    ["display math", ["$$", "| A | < |", "| --- | --- |", "| x | y |", "$$"].join("\n")],
  ])("ignores structural-looking tables inside %s", (_name, hidden) => {
    const source = `${hidden}\n\n| Visible | < |\n| --- | --- |\n| 1 | 2 |`;
    const tables = parseStructuralTables(source).tables;
    expect(tables).toHaveLength(1);
    expect(tables[0]?.rows[0]?.cells[0]?.content).toBe("Visible");
  });

  it.each([
    ["PRE attributes and mixed case", ['<PRE class="literal">'], "</pRe>"],
    ["script attributes", ['<script type="text/plain">'], "</SCRIPT>"],
    ["style split opening", ["<style", '  type="text/css">'], "</STYLE>"],
    ["textarea attributes", ['<textarea data-kind="literal">'], "</TEXTAREA>"],
  ])("ignores tables inside raw literal HTML and resumes after the closing line: %s", (_name, opening, closing) => {
    const hidden = "| Hidden | < |\n| --- | --- |\n| x | y |";
    const visible = "| Visible | B |\n| --- | --- |\n| 1 | 2 |";
    const source = [...opening, hidden, closing, visible].join("\n");
    const tables = parseEditableTables(source).tables;

    expect(tables).toHaveLength(1);
    expect(tables[0]?.rows[0]?.cells[0]?.content).toBe("Visible");
  });

  it.each(["pre", "script", "style", "textarea"])(
    "protects tables through EOF for unclosed raw literal <%s> HTML",
    (tag) => {
      const source = `<${tag}>\n| Hidden | B |\n| --- | --- |\n| 1 | 2 |`;
      expect(parseEditableTables(source).tables).toEqual([]);
    },
  );

  it("resumes parsing after a raw literal HTML block that opens and closes on one line", () => {
    const source = '<PRE class="literal">raw</pre>\n| Visible | B |\n| --- | --- |\n| 1 | 2 |';
    expect(parseEditableTables(source).tables.map((candidate) => candidate.rows[0]?.cells[0]?.content))
      .toEqual(["Visible"]);
  });

  it.each([
    "Use `%%` literally.", "Use ``<!--`` literally.", "Use `$$` literally.",
    String.raw`Escaped \%% marker`, String.raw`Escaped \<!-- marker`,
    "    %% indented code", "    <!-- indented code", "$x%%y$", "$$x$$",
  ])("preserves tables after literal or closed protection syntax %j", (prose) => {
    const source = `${prose}\n\n| A | B |\n| --- | --- |\n| x | y |`;
    expect(parseEditableTables(source).tables).toHaveLength(1);
  });

  it.each(["x <!-- hidden -->", "x %% hidden %%", "`<!--`", "`%%`", "$$x$$"])(
    "preserves a complete row with inline content %j", (content) => {
      const source = `| A | B |\n| --- | --- |\n| ${content} | y |`;
      const table = parseEditableTables(source).tables[0];
      expect(table?.rows).toHaveLength(2);
      expect(table?.rows[1]?.cells[0]?.content).toBe(content);
      expect(table?.source).toBe(source);
    },
  );

  it.each(["$$x", "<!--text", "%% text"])("protects blocks with opening-line content %j", (opening) => {
    const closing = opening.startsWith("<!--") ? "-->" : opening.slice(0, 2);
    const source = `${opening}\n| A | B |\n| --- | --- |\n| x | y |\ntext${closing}\n\n| C | D |\n| --- | --- |`;
    expect(parseEditableTables(source).tables.map((table) => table.rows[0]?.cells[0]?.content)).toEqual(["C"]);
  });

  it("continues scanning after a closed comment and does not read fences inside comments", () => {
    const source = "<!-- done --> %% open\n```\n| A | B |\n| --- | --- |\n%%\n\n| C | D |\n| --- | --- |";
    expect(parseEditableTables(source).tables.map((table) => table.rows[0]?.cells[0]?.content)).toEqual(["C"]);
  });

  it.each(["> %%", "> <!--", "> $$x", "- item\n  %%", "- item\n  <!--", "- item\n  $$x"])(
    "ends block protection at the containing quote/list boundary %j", (opening) => {
      const source = `${opening}\n\n| A | B |\n| --- | --- |\n| x | y |`;
      expect(parseEditableTables(source).tables).toHaveLength(1);
    },
  );

});
