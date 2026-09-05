// @vitest-environment happy-dom

import { type App, Component, MarkdownRenderer } from "obsidian";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { parseStructuralTables } from "../src/core/parser";
import { renderStructuralTable } from "../src/rendering/table-renderer";

interface ObsidianElementOptions {
  cls?: string;
}

beforeAll(() => {
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: ObsidianElementOptions,
  ): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function createDiv(options?: ObsidianElementOptions): HTMLDivElement {
    return this.createEl("div", options);
  };
});

describe("renderStructuralTable", () => {
  it("identifies nested column groups without crossing row-spanning or terminal headers", () => {
    const source = [
      "| Region | Results | < | < | < |",
      "| ^ | Sales | < | Costs | < |",
      "| ^ | Q1 | Q2 | Q1 | Q2 |",
      "| --- || --- | --- | --- | --- |",
      "| North | 10 | 12 | 4 | 5 |",
      "",
      "| Region | Summary | < | Detail | < |",
      "| ^ | ^ | ^ | A | B |",
      "| --- || --- | --- | --- | --- |",
      "| North | 10 | 12 | 4 | 5 |",
    ].join("\n");
    const tables = parseStructuralTables(source).tables;
    expect(tables).toHaveLength(2);
    const container = document.createElement("div");
    const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, element) => {
      element.textContent = text;
    });
    try {
      for (const table of tables) {
        expect(table.valid).toBe(true);
        renderStructuralTable({} as App, table, container, "Headers.md", new Component());
      }
      const groups = container.querySelectorAll('thead th[colspan][data-structural-header-end="false"]');
      expect([...groups].map((element) => element.textContent)).toEqual(["Results", "Sales", "Costs", "Detail"]);
      const spanningHeaders = container.querySelectorAll('thead th[rowspan]');
      expect([...spanningHeaders].map((element) => element.getAttribute("data-structural-header-end")))
        .toEqual(["true", "true", "true"]);
      expect(container.querySelector("tbody [data-structural-header-end]")).toBeNull();
    } finally {
      render.mockRestore();
    }
  });

  it.each(["<br>", "<br/>", "<br />"])("passes the exact %s spelling to Obsidian's renderer", (tag) => {
    const source = `| Name | Note |\n| --- || --- |\n| Alice | First${tag}Second |`;
    const table = parseStructuralTables(source).tables[0];
    const render = vi.spyOn(MarkdownRenderer, "render");

    expect(table?.valid).toBe(true);
    renderStructuralTable(
      {} as App,
      table!,
      document.createElement("div"),
      "Breaks.md",
      new Component(),
    );

    expect(render.mock.calls.map((call) => call[1])).toContain(`First${tag}Second`);
    render.mockRestore();
  });

  it("marks real block and inline edges after row and column spans", () => {
    const source = [
      "| A | B | C |",
      "| --- | --- | --- |",
      "| D | E | < |",
      "| ^ | F | G |",
    ].join("\n");
    const table = parseStructuralTables(source).tables[0];
    const container = document.createElement("div");

    renderStructuralTable({} as App, table!, container, "Edges.md", new Component());

    const spanningColumn = container.querySelector<HTMLElement>(
      "[data-structural-row='1'][data-structural-column='1']",
    );
    const spanningRow = container.querySelector<HTMLElement>(
      "[data-structural-row='1'][data-structural-column='0']",
    );
    const bottomRight = container.querySelector<HTMLElement>(
      "[data-structural-row='2'][data-structural-column='2']",
    );
    expect(spanningColumn?.dataset.structuralInlineEnd).toBe("true");
    expect(spanningColumn?.dataset.structuralBlockEnd).toBe("false");
    expect(spanningRow?.dataset.structuralInlineEnd).toBe("false");
    expect(spanningRow?.dataset.structuralBlockEnd).toBe("true");
    expect(bottomRight?.dataset.structuralInlineEnd).toBe("true");
    expect(bottomRight?.dataset.structuralBlockEnd).toBe("true");
  });
});
