// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
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

describe("Grid header boundaries", () => {
  const cases = [
    {
      name: "merged corner and row headers with nested column headers",
      source: "| Region | < | Results | < |\n| ^ | ^ | Q1 | Q2 |\n| --- | --- || --- | --- |\n| North | < | 10 | 12 |\n| ^ | ^ | 20 | 22 |",
      block: ["0:0", "1:2", "1:3"],
      inline: ["0:0", "2:0"],
    },
    {
      name: "row headers without column headers",
      source: "| --- | --- || --- | --- |\n| North | < | 10 | 12 |\n| ^ | ^ | 20 | 22 |",
      block: [],
      inline: ["0:0"],
    },
    {
      name: "multiple row-header columns with an interior rowspan",
      source: "| Region | Site | Value |\n| --- | --- || --- |\n| North | A | 10 |\n| ^ | B | 20 |",
      block: ["0:0", "0:1", "0:2"],
      inline: ["0:1", "1:1", "2:1"],
    },
    {
      name: "column headers without row headers",
      source: "| Region | Results | < |\n| ^ | Q1 | Q2 |\n| --- | --- | --- |\n| North | 10 | 12 |",
      block: ["0:0", "1:1", "1:2"],
      inline: [],
    },
    {
      name: "no headers",
      source: "| --- | --- |\n| Alice | 10 |\n| Bob | 20 |",
      block: [],
      inline: [],
    },
    {
      name: "column headers with no body",
      source: "| Region | Results | < |\n| ^ | Q1 | Q2 |\n| --- | --- | --- |",
      block: [],
      inline: [],
    },
    {
      name: "corner and column headers with no body",
      source: "| Key | Value |\n| --- || --- |",
      block: [],
      inline: [],
    },
  ];

  it.each(cases)("emphasizes only the complete semantic boundaries: $name", async ({ source, block, inline }) => {
    const table = parseStructuralTables(source).tables[0]!;
    expect(table.valid).toBe(true);
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = "body { --table-border-width: 1px; --table-border-color: rgb(80, 140, 200); }\n"
      + readFileSync("styles.css", "utf8");
    const container = document.body.appendChild(document.createElement("div"));
    const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, element) => {
      element.textContent = text;
    });
    try {
      const rendered = renderStructuralTable({} as App, table, container, "Grid.md", new Component());
      (rendered.parentElement as HTMLElement).dataset.appearance = "grid";
      await Promise.resolve();
      const cells = [...rendered.querySelectorAll<HTMLElement>("th, td")];
      const emphasized = (property: string): string[] => cells
        .filter((cell) => getComputedStyle(cell).getPropertyValue(property) === "2px")
        .map((cell) => `${cell.dataset.structuralRow}:${cell.dataset.structuralColumn}`);
      expect(emphasized("border-block-end-width")).toEqual(block);
      expect(emphasized("border-inline-end-width")).toEqual(inline);
      for (const cell of cells) {
        expect(getComputedStyle(cell).borderTopWidth).toBe("1px");
        expect(getComputedStyle(cell).borderTopColor).toBe("rgb(80, 140, 200)");
        expect(getComputedStyle(cell).borderTopStyle).toBe("solid");
      }
      expect(table.source).toBe(source);
    } finally {
      render.mockRestore();
      container.remove();
      style.remove();
    }
  });

  it.each(["ltr", "rtl"])("keeps the row-header boundary on the logical inline end in %s Live Preview", (direction) => {
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = "body { --table-border-width: 1px; --table-border-color: gray; }\n"
      + readFileSync("styles.css", "utf8");
    const container = document.body.appendChild(document.createElement("div"));
    container.className = "structural-tables-live-preview";
    container.dataset.appearance = "grid";
    container.dir = direction;
    try {
      const table = parseStructuralTables("| --- || --- |\n| North | 10 |").tables[0]!;
      const rendered = renderStructuralTable({} as App, table, container, "Direction.md", new Component());
      const header = getComputedStyle(rendered.querySelector("th")!);
      expect(header.getPropertyValue("border-inline-end-width")).toBe("2px");
      expect(header.getPropertyValue("border-inline-start-width")).toBe("1px");
      expect(header.borderLeftWidth).toBe("1px");
      expect(header.borderRightWidth).toBe("1px");
    } finally {
      container.remove();
      style.remove();
    }
  });

  it.each(["theme", "three-line"])("does not add Grid boundary emphasis to %s", (appearance) => {
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = "body { --table-border-width: 1px; --table-border-color: gray; --text-normal: black; }\n"
      + ".markdown-rendered :is(th, td) { border: 1px solid gray; }\n"
      + readFileSync("styles.css", "utf8");
    const container = document.body.appendChild(document.createElement("div"));
    try {
      const table = parseStructuralTables("| Region | Value |\n| --- || --- |\n| North | 10 |").tables[0]!;
      const rendered = renderStructuralTable({} as App, table, container, "Appearance.md", new Component());
      (rendered.parentElement as HTMLElement).dataset.appearance = appearance;
      for (const cell of rendered.querySelectorAll("th, td")) {
        const computed = getComputedStyle(cell);
        expect(computed.getPropertyValue("border-block-end-width")).not.toBe("2px");
        expect(computed.getPropertyValue("border-inline-end-width")).not.toBe("2px");
      }
      if (appearance === "three-line") {
        expect(getComputedStyle(rendered.tHead!).getPropertyValue("border-block-end")).toBe("1px solid black");
      }
    } finally {
      container.remove();
      style.remove();
    }
  });
});

describe("renderStructuralTable", () => {
  it("gives empty and merged cells a persistent content layer without inserting placeholder text", async () => {
    const source = "| A | B | C |\n| --- | --- | --- |\n|  |  | < |\n| ^ | Value | End |";
    const table = parseStructuralTables(source).tables[0]!;
    const container = document.createElement("div");
    const targets: HTMLElement[] = [];
    const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, element) => {
      targets.push(element);
      element.textContent = text;
    });
    try {
      const rendered = renderStructuralTable({} as App, table, container, "Content.md", new Component());
      const cells = [...rendered.querySelectorAll<HTMLTableCellElement>("th, td")];
      expect(render).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(targets).toHaveLength(cells.length);
      for (const [index, cell] of cells.entries()) {
        expect(cell.firstElementChild).toBe(targets[index]);
        expect(targets[index]?.classList.contains("structural-tables-cell-content")).toBe(true);
      }
      expect(rendered.querySelector("[rowspan='2']")?.textContent).toBe("");
      expect(rendered.querySelector("[colspan='2']")?.textContent).toBe("");
      expect(table.source).toBe(source);
    } finally {
      render.mockRestore();
    }
  });

  it("renders headerless tables entirely in tbody while keeping row-header scope", async () => {
    const source = "| --- || --- |\n| Alice | 10 |\n| Bob | 20 |";
    const table = parseStructuralTables(source).tables[0]!;
    const container = document.createElement("div");
    const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, element) => {
      element.textContent = text;
    });
    try {
      const rendered = renderStructuralTable({} as App, table, container, "Headerless.md", new Component());
      await Promise.resolve();
      expect(rendered.querySelector("thead")).toBeNull();
      expect(rendered.querySelectorAll("tbody tr")).toHaveLength(2);
      expect(rendered.querySelector("tbody th")?.getAttribute("scope")).toBe("row");
      expect(rendered.querySelector("tbody th")?.textContent).toBe("Alice");
      expect(rendered.querySelectorAll("tbody td")).toHaveLength(2);
    } finally {
      render.mockRestore();
    }
  });

  it("identifies nested column groups without crossing row-spanning or terminal headers", async () => {
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
      await Promise.resolve();
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

  it.each(["<br>", "<br/>", "<br />"])("passes the exact %s spelling to Obsidian's renderer", async (tag) => {
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
    expect(render).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(render.mock.calls.map((call) => call[1])).toContain(`First${tag}Second`);
    render.mockRestore();
  });

  it("cancels deferred rendering when its component is destroyed before the microtask", async () => {
    const table = parseStructuralTables("| A | B |\n| --- || --- |\n| 1 | 2 |").tables[0]!;
    const component = new Component();
    component.load();
    const render = vi.spyOn(MarkdownRenderer, "render");

    renderStructuralTable({} as App, table, document.createElement("div"), "Cancelled.md", component);
    component.unload();
    await Promise.resolve();

    expect(render).not.toHaveBeenCalled();
    render.mockRestore();
  });

  it("falls back to source text if deferred Markdown rendering rejects", async () => {
    const table = parseStructuralTables("| A | B |\n| --- || --- |\n| 1 | 2 |").tables[0]!;
    vi.spyOn(MarkdownRenderer, "render").mockRejectedValue(new Error("post-processor failed"));
    const container = document.createElement("div");
    renderStructuralTable({} as App, table, container, "Fallback.md", new Component());
    await Promise.resolve();
    await Promise.resolve();

    expect([...container.querySelectorAll(".structural-tables-cell-content")].map((el) => el.textContent))
      .toEqual(["A", "B", "1", "2"]);
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
