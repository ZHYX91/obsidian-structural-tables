// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { parseStructuralTables } from "../src/core/parser";
import { rawStructuralTableElement, renderedTableFor } from "../src/reading/table-mapping";

describe("renderedTableFor", () => {
  it("selects the structural DOM table after an ordinary Markdown table", () => {
    const source = "| Plain | Table |\n| --- | --- |\n| 1 | 2 |\n\n| A | < |\n| --- | --- |";
    const table = parseStructuralTables(source).tables[0]!;
    const ordinary = { kind: "ordinary" };
    const structural = { kind: "structural" };
    expect(renderedTableFor([ordinary, structural], table)).toBe(structural);
  });
});

describe("rawStructuralTableElement", () => {
  it("finds an unparsed row-header table without replacing its surrounding section", () => {
    const source = "| Region | Sales |\n| --- || --- |\n| North | 10 |";
    const table = parseStructuralTables(source).tables[0]!;
    const section = document.createElement("div");
    const heading = section.appendChild(document.createElement("h2"));
    heading.textContent = "Report";
    const paragraph = section.appendChild(document.createElement("p"));
    source.split("\n").forEach((line, index) => {
      if (index > 0) paragraph.appendChild(document.createElement("br"));
      paragraph.append(line);
    });

    expect(rawStructuralTableElement(section, table)).toBe(paragraph);
  });

  it("fails closed for table-looking source inside code", () => {
    const source = "| Region | Sales |\n| --- || --- |\n| North | 10 |";
    const table = parseStructuralTables(source).tables[0]!;
    const section = document.createElement("div");
    const code = section.appendChild(document.createElement("pre")).appendChild(document.createElement("code"));
    code.textContent = source;

    expect(rawStructuralTableElement(section, table)).toBeUndefined();
  });

  it.each(["<br>", "<br/>", "<br />"])(
    "matches raw row-header source after Obsidian renders %s as a BR element",
    (tag) => {
      const source = `| Syntax | Rendered |\n| --- || --- |\n| HTML | First${tag}Second |`;
      const table = parseStructuralTables(source).tables[0]!;
      const section = document.createElement("div");
      const paragraph = section.appendChild(document.createElement("p"));
      paragraph.append("| Syntax | Rendered |");
      paragraph.appendChild(document.createElement("br"));
      paragraph.append("| --- || --- |");
      paragraph.appendChild(document.createElement("br"));
      paragraph.append("| HTML | First");
      paragraph.appendChild(document.createElement("br"));
      paragraph.append("Second |");

      expect(rawStructuralTableElement(section, table)).toBe(paragraph);
    },
  );

  it("matches raw source after the host renders Wiki links and inline code", () => {
    const source = [
      "| Region | Sales | < |",
      "| Quarter | Q1 | Q2 |",
      "| --- || --- | --- |",
      "| North | 10 | 中文 [[Target\\|Alias]] `a|b` |",
      "| ^ | 8 | 11 |",
    ].join("\n");
    const table = parseStructuralTables(source).tables[0]!;
    const section = document.createElement("div");
    const paragraph = section.appendChild(document.createElement("p"));
    paragraph.append("| Region | Sales | < |");
    paragraph.appendChild(document.createElement("br"));
    paragraph.append("| Quarter | Q1 | Q2 |");
    paragraph.appendChild(document.createElement("br"));
    paragraph.append("| --- || --- | --- |");
    paragraph.appendChild(document.createElement("br"));
    paragraph.append("| North | 10 | 中文 ");
    const link = paragraph.appendChild(document.createElement("a"));
    link.textContent = "Alias";
    paragraph.append(" ");
    const code = paragraph.appendChild(document.createElement("code"));
    code.textContent = "a|b";
    paragraph.append(" |");
    paragraph.appendChild(document.createElement("br"));
    paragraph.append("| ^ | 8 | 11 |");

    expect(rawStructuralTableElement(section, table)).toBe(paragraph);
  });
});
