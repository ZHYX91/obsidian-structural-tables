// @vitest-environment happy-dom

import { type App, MarkdownRenderer, type MarkdownPostProcessorContext } from "obsidian";
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
  it("maps rich callout source with coarse section metadata and preserves the ordinary neighbour", async () => {
    const structural = "> | Name | Value |\n> | --- || --- |\n> | **Software** | Applications |";
    const ordinary = "> | Plain | Table |\n> | --- | --- |\n> | Kept | Native |";
    const source = `> [!navbox] Mixed\n${structural}\n>\n${ordinary}`;
    const raw = "<p>| Name | Value |<br>| --- || --- |<br>| <strong>Software</strong> | Applications |</p>";
    const native = "<table><thead><tr><th>Plain</th><th>Table</th></tr></thead><tbody><tr><td>Kept</td><td>Native</td></tr></tbody></table>";
    const container = document.createElement("div");
    container.innerHTML = `<div class="callout"><div class="callout-content">${raw}${native}</div></div>`;
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div"); element.className = options.cls; return element;
    });
    const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const target = args[2] as HTMLElement;
      if (target.className === "structural-tables-container") target.innerHTML = (args[1] as string).includes("Software") ? raw : native;
    });
    try {
      await new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS).process(container, {
        addChild: vi.fn(), sourcePath: "Callout.md",
        getSectionInfo: () => ({ text: source, lineStart: 0, lineEnd: 7 }),
      } as unknown as MarkdownPostProcessorContext);
      expect(container.querySelectorAll(".structural-tables-table")).toHaveLength(1);
      expect(container.querySelector("tbody th")?.getAttribute("scope")).toBe("row");
      expect([...container.querySelectorAll("table")].pop()?.textContent).toBe("PlainTableKeptNative");
    } finally { render.mockRestore(); vi.unstubAllGlobals(); }
  });
  it.each(["> ", ">> ", "    "])("renders a container table in an isolated section %j", (prefix) => {
    const bare = "| Region | Sales |\n| --- || --- |\n| North | 10 |";
    const source = "- outer\n  - inner\n\n" + bare.split("\n").map((line) => prefix + line).join("\n");
    const container = document.createElement("div");
    container.appendChild(rawBlock(bare));
    const render = vi.spyOn(MarkdownRenderer, "render");
    const context = {
      addChild: vi.fn(), sourcePath: "Report.md",
      getSectionInfo: () => ({ lineStart: 3, lineEnd: 5, text: source }),
    } as unknown as MarkdownPostProcessorContext;
    new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS).process(container, context);
    expect(container.querySelectorAll(".structural-tables-table")).toHaveLength(1);
    expect(render.mock.calls.map((call) => call[1])).toContain("North");
    render.mockRestore();
  });

  it("does not acquire YAML scalar text when the section omits the frontmatter delimiters", () => {
    const bare = "| Region | Sales |\n| --- || --- |\n| North | 10 |";
    const source = "---\nexample: |\n" + bare.split("\n").map((line) => "  " + line).join("\n") + "\n---";
    const container = rawBlock(bare);
    new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS).process(container, {
      addChild: vi.fn(), sourcePath: "Report.md",
      getSectionInfo: () => ({ lineStart: 2, lineEnd: 4, text: source }),
    } as unknown as MarkdownPostProcessorContext);
    expect(container.querySelector(".structural-tables-table")).toBeNull();
  });
  it("binds richly formatted raw source by its section without consuming a later ordinary table", () => {
    const structural = "| Region | Link |\n| --- || --- |\n| **North** | [Report](Report.md) &amp; ==highlight== |";
    const ordinary = "| Name | Status |\n| --- | --- |\n| Alice | Ready |";
    const source = `${structural}\n\n${ordinary}`;
    const container = document.createElement("div");
    const raw = container.appendChild(document.createElement("p"));
    raw.innerHTML = "| Region | Link |<br>| --- || --- |<br>| <strong>North</strong> | <a>Report</a> &amp; <mark>highlight</mark> |";
    const native = container.appendChild(document.createElement("table"));
    native.innerHTML = "<tbody><tr><td>Alice</td><td>Ready</td></tr></tbody>";
    const context = {
      addChild: vi.fn(),
      getSectionInfo: (element: HTMLElement) => ({ lineStart: 0, lineEnd: element === raw ? 2 : 6, text: source }),
      sourcePath: "Report.md",
    } as unknown as MarkdownPostProcessorContext;
    new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS).process(container, context);
    expect(raw.parentElement).toBeNull();
    expect(native.parentElement).toBe(container);
    expect(container.querySelectorAll(".structural-tables-table")).toHaveLength(1);
  });

  it("preserves a later native table when a raw row-header block cannot be mapped", () => {
    const source = "| Region | Link |\n| --- || --- |\n| **North** | report |\n\n| Name | Status |\n| --- | --- |\n| Alice | Ready |";
    const container = document.createElement("div");
    const raw = container.appendChild(document.createElement("p"));
    raw.textContent = "An unrelated renderer owns this block";
    const native = container.appendChild(document.createElement("table"));
    native.textContent = "Alice Ready";
    const context = {
      addChild: vi.fn(),
      getSectionInfo: () => ({ lineStart: 0, lineEnd: 6, text: source }),
      sourcePath: "Report.md",
    } as unknown as MarkdownPostProcessorContext;
    new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS).process(container, context);
    expect(native.parentElement).toBe(container);
    expect(raw.parentElement).toBe(container);
    expect(container.querySelector(".structural-tables-table")).toBeNull();
  });

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

  it("renders raw structural source containing a Wiki-link alias and an inline-code pipe", () => {
    const table = [
      "| Region | Sales | < |",
      "| Quarter | Q1 | Q2 |",
      "| --- || --- | --- |",
      "| North | 10 | 中文 [[Target\\|Alias]] `a|b` |",
      "| ^ | 8 | 11 |",
    ].join("\n");
    const container = document.createElement("div");
    const raw = container.appendChild(document.createElement("p"));
    raw.append("| Region | Sales | < |");
    raw.appendChild(document.createElement("br"));
    raw.append("| Quarter | Q1 | Q2 |");
    raw.appendChild(document.createElement("br"));
    raw.append("| --- || --- | --- |");
    raw.appendChild(document.createElement("br"));
    raw.append("| North | 10 | 中文 ");
    raw.appendChild(document.createElement("a")).textContent = "Alias";
    raw.append(" ");
    raw.appendChild(document.createElement("code")).textContent = "a|b";
    raw.append(" |");
    raw.appendChild(document.createElement("br"));
    raw.append("| ^ | 8 | 11 |");
    const addChild = vi.fn();
    const context = {
      addChild,
      getSectionInfo: () => ({ lineStart: 0, lineEnd: 4, text: table }),
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
  });

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

  it("uses the element's bounded source lines instead of substituting an earlier structural table", () => {
    const structural = "| Region | Sales |\n| --- || --- |\n| North | 10 |";
    const ordinary = "| Name | Status |\n| --- | --- |\n| Alice | Ready |";
    const source = `${structural}\n\n# Native\n\n${ordinary}`;
    const native = document.createElement("table");
    native.innerHTML = "<thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>Alice</td><td>Ready</td></tr></tbody>";
    const container = document.createElement("div");
    container.appendChild(native);
    const render = vi.spyOn(MarkdownRenderer, "render");
    const context = {
      addChild: vi.fn(),
      getSectionInfo: () => ({ lineStart: 6, lineEnd: 8, text: source }),
      sourcePath: "People.md",
    } as unknown as MarkdownPostProcessorContext;
    const processor = new StructuralTableReadingProcessor(
      {} as App,
      () => ({ ...DEFAULT_SETTINGS, enableReadingView: true, takeOverOrdinaryTables: true }),
    );

    processor.process(container, context);

    expect(native.parentElement).toBeNull();
    expect(render.mock.calls.map((call) => call[1])).toContain("Alice");
    expect(render.mock.calls.map((call) => call[1])).not.toContain("North");
    render.mockRestore();
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
