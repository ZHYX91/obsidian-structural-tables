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
});
