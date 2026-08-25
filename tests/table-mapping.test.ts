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
});
