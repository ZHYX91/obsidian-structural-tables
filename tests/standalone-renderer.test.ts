// @vitest-environment happy-dom
import MarkdownIt from "markdown-it";
import { App, MarkdownRenderer, TFile, type MarkdownPostProcessorContext, type MarkdownRenderChild } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { StructuralTableReadingProcessor } from "../src/reading/table-postprocessor";

const markdown = new MarkdownIt({ html: true });
const merged = "| Region | Sales | < |\n| --- | --- | --- |\n| North | 10 | < |\n| ^ | 8 | 11 |";

beforeAll(() => {
  globalThis.createDiv = () => document.createElement("div");
  HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { cls?: string }) {
    const el = this.ownerDocument.createElement(tag);
    if (options?.cls) el.className = options.cls;
    this.appendChild(el);
    return el;
  };
  HTMLElement.prototype.createDiv = function(options?: { cls?: string }) { return this.createEl("div", options); };
});
afterEach(() => vi.restoreAllMocks());

function harness(source = merged, displayed = source) {
  const file = Object.assign(Object.create(TFile.prototype) as TFile, { path: "Export.md" });
  const cachedRead = vi.fn(async () => source);
  const getAbstractFileByPath = vi.fn(() => file);
  const app = { vault: { cachedRead, getAbstractFileByPath } } as unknown as App;
  const container = document.createElement("div");
  container.innerHTML = markdown.render(displayed);
  const children: MarkdownRenderChild[] = [];
  const context = { sourcePath: file.path, getSectionInfo: () => null,
    addChild: (child: MarkdownRenderChild) => { children.push(child); child.load(); },
  } as unknown as MarkdownPostProcessorContext;
  const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, target) => {
    target.innerHTML = markdown.render(text);
  });
  const settings = { ...DEFAULT_SETTINGS };
  const processor = new StructuralTableReadingProcessor(app, () => settings);
  return { container, context, children, cachedRead, getAbstractFileByPath, render, settings,
    run: () => processor.process(container, context) };
}

describe("standalone Markdown rendering", () => {
  it("finishes merged geometry and rich cell content before an exporter clones the result", async () => {
    const h = harness(merged.replace("North", "**North**"));
    await h.run();
    const clone = h.container.cloneNode(true) as HTMLElement;
    expect(clone.querySelector("[rowspan='2'] strong")?.textContent).toBe("North");
    expect(clone.querySelector("[colspan='2']")?.textContent).toContain("Sales");
    expect(clone.textContent).not.toContain("^");
    expect(h.cachedRead).toHaveBeenCalledTimes(2);
  });

  it.each([
    "> [!note] Export\n" + merged.split("\n").map(line => "> " + line).join("\n"),
    "| Group | < |\n| A | B |\n| --- | --- |\n| 1 | 2 |",
    "| Name | Value |\n| --- || --- |\n| North | 10 |",
    "| --- | --- |\n| North | < |",
  ])("maps complete native blocks for container and header variants", async (source) => {
    const h = harness(source);
    await h.run();
    expect(h.container.querySelectorAll(".structural-tables-table")).toHaveLength(1);
    expect(h.container.textContent).not.toContain("|");
  });

  it("matches a selected table by identity rather than its position in the original note", async () => {
    const other = "| A | B |\n| --- | --- |\n| one | two |";
    const h = harness(other + "\n\n" + merged, merged);
    await h.run();
    expect(h.container.querySelector("[rowspan='2']")?.textContent).toContain("North");
    expect(h.container.textContent).not.toContain("one");
  });

  it("waits for delayed cell renderers before resolving", async () => {
    const h = harness();
    h.render.mockImplementation(async (_app, text, target) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      target.innerHTML = markdown.render(text);
    });
    await h.run();
    expect(h.container.querySelector("[rowspan='2']")?.textContent).toContain("North");
    expect(h.container.querySelectorAll(".structural-tables-cell-content:empty")).toHaveLength(0);
  });

  it("distinguishes links with the same label and different destinations", async () => {
    const source = merged.replace("North", "[North](one.md)");
    const h = harness(source, source.replace("one.md", "two.md"));
    const original = h.container.innerHTML;
    await h.run();
    expect(h.container.innerHTML).toBe(original);
  });

  it.each(["\\<", "`<`", "&#60;", "**<**"])("leaves literal marker %s unchanged", async (literal) => {
    const source = "| A | B |\n| --- | --- |\n| X | " + literal + " |";
    const h = harness(source);
    const original = h.container.innerHTML;
    await h.run();
    expect(h.container.innerHTML).toBe(original);
  });

  it("refuses ambiguous escaped and structural tables with identical native DOM", async () => {
    const h = harness(merged + "\n\n" + merged.replace(/</gu, "\\<").replace(/\^/gu, "\\^"), merged);
    const original = h.container.innerHTML;
    await h.run();
    expect(h.container.innerHTML).toBe(original);
  });

  it.each(["source", "disabled", "unload", "DOM"])("abandons stale work after %s changes", async (kind) => {
    const h = harness();
    const original = h.container.innerHTML;
    h.render.mockImplementation(async (_app, text, target) => {
      target.innerHTML = markdown.render(text);
      if (kind === "source") h.cachedRead.mockResolvedValue("changed");
      if (kind === "disabled") h.settings.enableReadingView = false;
      if (kind === "unload") (h.children[0] as unknown as { onunload(): void }).onunload();
      if (kind === "DOM") h.container.querySelector("td")!.textContent = "External edit";
    });
    await h.run();
    expect(h.container.querySelector(".structural-tables-table")).toBeNull();
    if (kind !== "DOM") expect(h.container.innerHTML).toBe(original);
  });

  it("leaves invalid topology and foreign embedded tables alone", async () => {
    const h = harness(merged, merged);
    h.container.className = "markdown-embed";
    await h.run();
    expect(h.render).not.toHaveBeenCalled();
    const invalid = harness("| A | B |\n| --- | --- |\n| ^ | X |");
    await invalid.run();
    expect(invalid.container.querySelector(".structural-tables-table")).toBeNull();
  });

  it("fails closed when source reads or native rendering fail", async () => {
    for (const stage of ["read", "render"] as const) {
      const h = harness();
      const original = h.container.innerHTML;
      if (stage === "read") h.cachedRead.mockRejectedValue(new Error("unavailable"));
      else h.render.mockRejectedValue(new Error("unavailable"));
      await h.run();
      expect(h.container.innerHTML).toBe(original);
      vi.restoreAllMocks();
    }
  });
});
