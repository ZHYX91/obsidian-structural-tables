// @vitest-environment happy-dom

import type { App, MarkdownPostProcessorContext } from "obsidian";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/config/settings";
import { StructuralTableReadingProcessor } from "../src/reading/table-postprocessor";

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

function rawBlock(source: string): HTMLDivElement {
  const block = document.createElement("div");
  source.split("\n").forEach((line, index) => {
    if (index > 0) block.appendChild(document.createElement("br"));
    block.append(line);
  });
  return block;
}

describe("StructuralTableReadingProcessor", () => {
  it("renders row-header syntax that the Markdown host leaves as raw pipe text", () => {
    const table = "| Region | Sales |\n| --- || --- |\n| North | 10 |";
    const source = `# Report\n\n${table}`;
    const container = document.createElement("div");
    container.appendChild(document.createElement("h1")).textContent = "Report";
    const raw = container.appendChild(rawBlock(table));
    const addChild = vi.fn();
    const context = {
      addChild,
      getSectionInfo: () => ({ lineStart: 0, lineEnd: 4, text: source }),
      sourcePath: "Report.md",
    } as unknown as MarkdownPostProcessorContext;
    const processor = new StructuralTableReadingProcessor(
      {} as App,
      () => ({ ...DEFAULT_SETTINGS, enableReadingView: true }),
    );

    processor.process(container, context);

    expect(raw.parentElement).toBeNull();
    expect(container.querySelector(".structural-tables-container table")).not.toBeNull();
    expect((container.querySelector("tbody th") as HTMLTableCellElement | null)?.scope).toBe("row");
    expect((container.querySelector("tbody th") as HTMLElement | null)?.dataset.structuralRole).toBe("row_header");
    expect(addChild).toHaveBeenCalledOnce();
  });

  it.each(["<br>", "<br/>", "<br />"])(
    "renders row-header source after the Markdown host converts %s to a BR element",
    (tag) => {
      const table = `| Syntax | Rendered |\n| --- || --- |\n| HTML | First${tag}Second |`;
      const container = document.createElement("div");
      const raw = container.appendChild(document.createElement("p"));
      raw.append("| Syntax | Rendered |");
      raw.appendChild(document.createElement("br"));
      raw.append("| --- || --- |");
      raw.appendChild(document.createElement("br"));
      raw.append("| HTML | First");
      raw.appendChild(document.createElement("br"));
      raw.append("Second |");
      const addChild = vi.fn();
      const context = {
        addChild,
        getSectionInfo: () => ({ lineStart: 0, lineEnd: 2, text: table }),
        sourcePath: "Report.md",
      } as unknown as MarkdownPostProcessorContext;
      const processor = new StructuralTableReadingProcessor(
        {} as App,
        () => ({ ...DEFAULT_SETTINGS, enableReadingView: true }),
      );

      processor.process(container, context);

      expect(raw.parentElement).toBeNull();
      expect(container.querySelector(".structural-tables-container table")).not.toBeNull();
      expect(addChild).toHaveBeenCalledOnce();
    },
  );

  it("replaces an ordinary Reading view table only when takeover is enabled", () => {
    const source = "| Name | Status |\n| --- | --- |\n| Alice | Doing |";
    const native = document.createElement("table");
    native.innerHTML = "<thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>Alice</td><td>Doing</td></tr></tbody>";
    const container = document.createElement("div");
    container.appendChild(native);
    const addChild = vi.fn();
    const context = {
      addChild,
      getSectionInfo: () => ({ lineStart: 0, lineEnd: 2, text: source }),
      sourcePath: "People.md",
    } as unknown as MarkdownPostProcessorContext;
    const processor = new StructuralTableReadingProcessor(
      {} as App,
      () => ({ ...DEFAULT_SETTINGS, takeOverOrdinaryTables: true }),
    );

    processor.process(container, context);

    expect(native.parentElement).toBeNull();
    expect(container.querySelector<HTMLElement>(".structural-tables-container")?.dataset.tableKind).toBe("ordinary");
    expect(container.querySelector("thead th")?.getAttribute("data-structural-role")).toBe("column_header");
    expect(addChild).toHaveBeenCalledOnce();
  });

  it("ignores recursive cell rendering when section information is unavailable", () => {
    const container = document.createElement("div");
    container.className = "structural-tables-container";
    const cell = container.appendChild(document.createElement("th"));
    cell.textContent = "Region";
    const processor = new StructuralTableReadingProcessor(
      {} as App,
      () => ({ ...DEFAULT_SETTINGS, enableReadingView: true }),
    );
    const context = {
      getSectionInfo: () => undefined,
      sourcePath: "Report.md",
    } as unknown as MarkdownPostProcessorContext;

    expect(() => processor.process(cell, context)).not.toThrow();
  });
});
