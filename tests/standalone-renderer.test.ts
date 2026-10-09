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

  it("keeps ordinary export DOM intact when native-table takeover is disabled", async () => {
    const ordinary = "| Name | Score |\n| :--- | ---: |\n| Alice | 10 |";
    const h = harness(ordinary);
    const original = h.container.innerHTML;
    await h.run();
    expect(h.container.innerHTML).toBe(original);
    expect(h.container.querySelector(".structural-tables-table")).toBeNull();
    expect(h.render).not.toHaveBeenCalled();
  });

  it("exports a verified ordinary table with Reading View appearance when takeover is enabled", async () => {
    const ordinary = "| Name | Score |\n| :--- | ---: |\n| Alice | 10 |";
    const h = harness(ordinary);
    h.settings.takeOverOrdinaryTables = true;
    h.settings.appearance = "grid";
    h.settings.density = "compact";
    h.settings.layout = "content-center";
    h.settings.zebraRows = true;
    await h.run();
    const wrapper = h.container.querySelector<HTMLElement>(".structural-tables-container");
    expect(wrapper?.dataset).toMatchObject({
      tableKind: "ordinary",
      appearance: "grid",
      density: "compact",
      layout: "content-center",
      zebra: "true",
      structuralTablesProcessed: "true",
    });
    expect(wrapper?.querySelectorAll("thead th")).toHaveLength(2);
    expect(wrapper?.querySelector("tbody td[data-align='right']")?.textContent).toBe("10");
    expect(h.container.cloneNode(true).textContent).toContain("Alice");
    expect(h.cachedRead).toHaveBeenCalledTimes(2);
  });

  it("maps only the source-verified ordinary table in a mixed structural note", async () => {
    const ordinary = "| Name | Score |\n| --- | --- |\n| Alice | 10 |";
    const h = harness(merged + "\n\n" + ordinary, ordinary);
    h.settings.takeOverOrdinaryTables = true;
    await h.run();
    expect(h.container.querySelectorAll(".structural-tables-table")).toHaveLength(1);
    expect(h.container.querySelector<HTMLElement>(".structural-tables-container")?.dataset.tableKind)
      .toBe("ordinary");
    expect(h.container.textContent).not.toContain("North");
  });

  it.each(["identical Markdown", "HTML alias"])(
    "refuses ambiguous ordinary-table sources: %s", async (kind) => {
      const ordinary = "| Name | Score |\n| --- | --- |\n| Alice | 10 |";
      const source = kind === "identical Markdown"
        ? ordinary + "\n\n" + ordinary
        : ordinary + "\n\n" + markdown.render(ordinary);
      const h = harness(source, ordinary);
      h.settings.takeOverOrdinaryTables = true;
      const original = h.container.innerHTML;
      await h.run();
      expect(h.container.innerHTML).toBe(original);
      expect(h.container.querySelector(".structural-tables-table")).toBeNull();
    },
  );

  it("honors takeover being disabled before an asynchronous export commits", async () => {
    const ordinary = "| Name | Score |\n| --- | --- |\n| Alice | 10 |";
    const h = harness(ordinary);
    h.settings.takeOverOrdinaryTables = true;
    const original = h.container.innerHTML;
    h.render.mockImplementation(async (_app, text, target) => {
      target.innerHTML = markdown.render(text);
      h.settings.takeOverOrdinaryTables = false;
    });
    await h.run();
    expect(h.container.innerHTML).toBe(original);
  });

  it("matches a selected table by identity rather than its position in the original note", async () => {
    const other = "| A | B |\n| --- | --- |\n| one | two |";
    const h = harness(other + "\n\n" + merged, merged);
    await h.run();
    expect(h.container.querySelector("[rowspan='2']")?.textContent).toContain("North");
    expect(h.container.textContent).not.toContain("one");
  });

  it("keeps merged geometry when a structural table contains inline code", async () => {
    const source = merged.replace("North", "`North`");
    const h = harness(source);
    await h.run();
    expect(h.container.querySelector("[rowspan='2'] code")?.textContent).toBe("North");
    expect(h.container.querySelector("[colspan='2']")).not.toBeNull();
    expect(h.container.textContent).not.toContain("^");
  });

  it("captures native ownership before third-party render children clean up their DOM", async () => {
    const h = harness();
    const cleaned: HTMLElement[] = [];
    h.render.mockImplementation(async (_app, text, target, _path, owner) => {
      target.innerHTML = markdown.render(text);
      owner.register(() => {
        cleaned.push(target);
        target.replaceChildren();
      });
    });
    await h.run();
    expect(cleaned).toHaveLength(2);
    expect(cleaned.every((target) => target.childElementCount === 0)).toBe(true);
    expect(h.container.querySelector("[rowspan='2']")?.textContent).toContain("North");
    expect(h.container.querySelector("[colspan='2']")).not.toBeNull();
  });

  it("retains ambiguity evidence even when third-party cleanup removes duplicate native blocks", async () => {
    const html = markdown.render(merged);
    const h = harness(merged + "\n\n" + html, html);
    const original = h.container.innerHTML;
    h.render.mockImplementation(async (_app, text, target, _path, owner) => {
      target.innerHTML = markdown.render(text);
      owner.register(() => target.querySelectorAll("table").forEach((table) => table.remove()));
    });
    await h.run();
    expect(h.container.innerHTML).toBe(original);
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

  it("awaits structural cells containing a native inline image embed", async () => {
    const source = "| Name | Value |\n| --- || --- |\n| ![North](north.png) | 10 |";
    const h = harness(source);
    const native = (text: string): string => markdown.render(text).replace(
      /(<img[^>]*>)/gu, '<span class="internal-embed image-embed">$1</span>',
    );
    h.container.innerHTML = native(source);
    h.render.mockImplementation(async (_app, text, target) => { target.innerHTML = native(text); });
    await h.run();
    expect(h.container.querySelectorAll(".structural-tables-table")).toHaveLength(1);
    expect(h.container.querySelector("tbody th img")?.getAttribute("src")).toBe("north.png");
  });

  it("preserves image destination and note-embed boundaries in standalone matching", async () => {
    const source = merged.replace("North", "![North](north.png)");
    for (const kind of ["destination", "note-embed"] as const) {
      const h = harness(source);
      if (kind === "destination") h.container.querySelector("img")!.setAttribute("src", "south.png");
      else h.container.innerHTML = `<div class="internal-embed">${h.container.innerHTML}</div>`;
      const before = h.container.innerHTML;
      await h.run();
      expect(h.container.innerHTML).toBe(before);
      vi.restoreAllMocks();
    }
  });

  it.each(["\\<", "`<`", "&#60;", "**<**"])("leaves literal marker %s unchanged", async (literal) => {
    const source = "| A | B |\n| --- | --- |\n| X | " + literal + " |";
    const h = harness(source);
    const original = h.container.innerHTML;
    await h.run();
    expect(h.container.innerHTML).toBe(original);
  });

  it("does not acquire a hand-written HTML table that matches a structural Markdown table", async () => {
    const structural = "| A | < |\n| --- | --- |\n| foo bar | x |";
    const html = [
      "<table>",
      "<thead><tr><th>A</th><th>&lt;</th></tr></thead>",
      "<tbody><tr><td>foo bar</td><td>x</td></tr></tbody>",
      "</table>",
    ].join("");
    const h = harness(structural + "\n\n" + html, html);
    const original = h.container.innerHTML;
    await h.run();
    expect(h.container.innerHTML).toBe(original);
    expect(h.container.querySelector(".structural-tables-table")).toBeNull();
  });

  it("refuses ambiguous escaped and structural tables with identical native DOM", async () => {
    const h = harness(merged + "\n\n" + merged.replace(/</gu, "\\<").replace(/\^/gu, "\\^"), merged);
    const original = h.container.innerHTML;
    await h.run();
    expect(h.container.innerHTML).toBe(original);
  });

  it("does not let an older session commit after its final source read resumes", async () => {
    const literal = merged.replace(/</gu, "\\<").replace(/\^/gu, "\\^");
    const h = harness();
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    h.cachedRead.mockReset();
    h.cachedRead
      .mockResolvedValueOnce(merged)
      .mockImplementationOnce(async () => pending)
      .mockResolvedValue(literal);

    const older = h.run();
    await vi.waitFor(() => expect(h.cachedRead).toHaveBeenCalledTimes(2));

    h.container.innerHTML = markdown.render(literal);
    await h.run();
    expect(h.container.querySelector(".structural-tables-table")).toBeNull();

    release(merged);
    await older;
    expect(h.container.querySelector(".structural-tables-table")).toBeNull();
    expect(h.container.textContent).toContain("<");
    expect(h.container.textContent).toContain("^");
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
