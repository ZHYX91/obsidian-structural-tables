// @vitest-environment happy-dom

import { type App, MarkdownRenderer, type MarkdownPostProcessorContext, type MarkdownRenderChild } from "obsidian";
import MarkdownIt from "markdown-it";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import { StructuralTableReadingProcessor } from "../src/reading/table-postprocessor";

// Markdown-it supplies native-like block boundaries. This is not a real Obsidian
// host test: postprocessor section metadata and render-child ownership are mocked.
const markdown = new MarkdownIt({ html: true, breaks: true });
const rowHeader = "| Region | Sales |\n| --- || --- |\n| North | 10 |";
const multiHeader = "| A | B |\n| C | D |\n| --- | --- |\n| E | F |";
const combined = "| Region | Sales | < |\n| Quarter | Q1 | Q2 |\n| --- || --- | --- |\n| North | 10 | 12 |\n| ^ | 8 | 11 |";

beforeAll(() => {
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K, options?: { cls?: string },
  ): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function createDiv(options?: { cls?: string }): HTMLDivElement {
    return this.createEl("div", options);
  };
});

beforeEach(() => {
  vi.stubGlobal("createDiv", (options?: { cls?: string }) => {
    const element = document.createElement("div");
    if (options?.cls !== undefined) element.className = options.cls;
    return element;
  });
  vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
    (args[2] as HTMLElement).innerHTML = markdown.render(args[1] as string);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function readingView(source: string, processor = new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS)) {
  const tokens = markdown.parse(source, {});
  const blocks = tokens.map((token, index) => ({ token, index })).filter(({ token }) => token.level === 0 && token.map !== null);
  const root = document.createElement("div");
  const children: MarkdownRenderChild[] = [];
  const state = { source };
  const sections = blocks.map(({ token, index }, blockIndex) => {
    const element = root.appendChild(document.createElement("div"));
    element.innerHTML = markdown.renderer.render(tokens.slice(index, blocks[blockIndex + 1]?.index ?? tokens.length), markdown.options, {});
    const context = {
      sourcePath: "Reading.md", docId: "reading-test",
      getSectionInfo: () => ({ text: state.source, lineStart: token.map![0], lineEnd: token.map![1] - 1 }),
      addChild: (child: MarkdownRenderChild) => { children.push(child); child.load(); },
    } as unknown as MarkdownPostProcessorContext;
    return { element, context };
  });
  const process = (order = sections.map((_, index) => index)): void => {
    for (const index of order) processor.process(sections[index]!.element, sections[index]!.context);
  };
  return { root, children, sections, state, process, processor };
}

async function settled(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("Reading View source/block boundaries", () => {
  it.each([
    ["isolated row header", rowHeader, 1],
    ["split multi-row header", multiHeader, 2],
    ["combined headers", combined, 2],
    ["prose before", "Intro\n" + rowHeader, 1],
    ["prose after", rowHeader + "\nAfter", 1],
    ["prose before combined headers", "Intro\n" + combined, 2],
    ["blank-separated prose", "Intro\n\n" + rowHeader + "\n\nAfter", 1],
    ["rich row header", rowHeader.replace("North", "**North**"), 1],
  ])("renders %s without changing source", async (_name, source, headers) => {
    const view = readingView(source as string);
    view.process();
    await settled();
    expect(view.root.querySelectorAll(".structural-tables-table")).toHaveLength(1);
    expect(view.root.querySelectorAll(".structural-tables-table thead tr")).toHaveLength(headers as number);
    expect(view.state.source).toBe(source);
  });

  it.each([[0, 1], [1, 0]])("maps split headers atomically in callback order %j and on repeated callbacks", async (...order) => {
    const view = readingView(multiHeader);
    expect(view.sections.map(({ context, element }) => {
      const info = context.getSectionInfo(element)!;
      return [info.lineStart, info.lineEnd];
    })).toEqual([[0, 0], [1, 3]]);
    view.process(order);
    view.process(order);
    await settled();
    view.process(order);
    await settled();
    expect(view.root.querySelectorAll("table")).toHaveLength(1);
    expect(view.root.querySelectorAll("thead tr")).toHaveLength(2);
    expect(view.root.textContent?.replace(/\s/gu, "")).toBe("ABCDEF");
    expect(view.sections.every(({ element }) => element.parentElement === view.root)).toBe(true);
  });

  it.each(["\n", "\r\n", "\r"])("preserves adjoining rich prose and inline node identity with %j source endings", async (ending) => {
    const source = `**Before** [link](before.md)\n${rowHeader.replace("North", "**North**")}\n*After* [link](after.md)`
      .replace(/\n/gu, ending);
    const view = readingView(source);
    const before = view.root.querySelector("strong");
    const after = view.root.querySelector("em");
    const links = Array.from(view.root.querySelectorAll("a"));
    view.process();
    await settled();
    expect(view.root.querySelectorAll(".structural-tables-table")).toHaveLength(1);
    expect(view.root.contains(before)).toBe(true);
    expect(view.root.contains(after)).toBe(true);
    expect(links.every((link) => view.root.contains(link))).toBe(true);
    expect(view.root.querySelectorAll("p > br:first-child, p > br:last-child")).toHaveLength(0);
    expect(view.root.textContent).toContain("Before link");
    expect(view.root.textContent).toContain("After link");
    expect(view.root.querySelector("tbody th strong")?.textContent?.trim()).toBe("North");
  });

  it("preserves intentional HTML breaks in adjoining prose", async () => {
    const view = readingView(`Intro<br><br>\n${rowHeader}\n<br><br>After`);
    view.process();
    await settled();
    expect(view.root.querySelectorAll(".structural-tables-table")).toHaveLength(1);
    const prose = Array.from(view.root.querySelectorAll("p")).filter((element) => !element.closest("table"));
    expect(prose.map((element) => element.querySelectorAll("br").length)).toEqual([2, 2]);
  });

  it("preserves non-text prose around a raw table instead of replacing their shared paragraph", async () => {
    const view = readingView(`![before](before.png)\n${rowHeader}\n![after](after.png)`);
    const images = Array.from(view.root.querySelectorAll("img"));
    view.process();
    await settled();
    expect(view.root.querySelectorAll(".structural-tables-table")).toHaveLength(1);
    expect(images).toHaveLength(2);
    expect(images.every((image) => view.root.contains(image))).toBe(true);
  });

  it("preserves a multiheader's preceding prose and ordinary neighbour", async () => {
    const ordinary = "| Plain | Table |\n| --- | --- |\n| Keep | Native |";
    const view = readingView(`**Intro**\n${multiHeader}\n\n${ordinary}`);
    const intro = view.root.querySelector("strong");
    const native = Array.from(view.root.querySelectorAll("table")).pop();
    view.process();
    await settled();
    expect(view.root.querySelectorAll(".structural-tables-table")).toHaveLength(1);
    expect(view.root.contains(intro)).toBe(true);
    expect(native?.parentElement).not.toBeNull();
    expect(native?.className).not.toContain("structural-tables-table");
  });

  it("maps successive raw tables sharing a paragraph without dropping a stale parallel plan", async () => {
    const source = `Intro\n${rowHeader}\nBetween\n${rowHeader.replace("North", "South")}\nAfter`;
    expect(parseEditableTables(source).tables).toHaveLength(2);
    const view = readingView(source);
    expect(view.sections).toHaveLength(1);
    view.process();
    await settled();
    expect(view.root.querySelectorAll(".structural-tables-table")).toHaveLength(2);
    for (const prose of ["Intro", "Between", "After"]) expect(view.root.textContent).toContain(prose);
  });

  it("does not acquire a split native table before its header section is observed", async () => {
    const view = readingView(multiHeader);
    const before = view.root.innerHTML;
    view.process([1]);
    await settled();
    expect(view.root.innerHTML).toBe(before);
  });

  it.each(["pre", "blockquote", "embed", "owned", "unknown"])("does not bridge a %s DOM barrier", async (kind) => {
    const view = readingView(multiHeader);
    const barrier = document.createElement(kind === "pre" ? "pre" : kind === "blockquote" ? "blockquote" : "div");
    if (kind === "embed") barrier.className = "internal-embed";
    if (kind === "owned") barrier.className = "structural-tables-container";
    barrier.textContent = "Keep";
    view.sections[0]!.element.after(barrier);
    const before = view.root.innerHTML;
    view.process();
    await settled();
    expect(view.root.innerHTML).toBe(before);
  });

  it.each(["line gap", "source", "path", "document"])("does not join sections with mismatched %s", async (kind) => {
    const view = readingView(multiHeader);
    const second = view.sections[1]!;
    const original = second.context.getSectionInfo(second.element)!;
    second.context.getSectionInfo = () => ({ ...original,
      lineStart: kind === "line gap" ? original.lineStart + 1 : original.lineStart,
      text: kind === "source" ? original.text + "\nChanged" : original.text });
    if (kind === "path") second.context.sourcePath = "Other.md";
    if (kind === "document") second.context.docId = "other-document";
    const before = view.root.innerHTML;
    view.process();
    await settled();
    expect(view.root.innerHTML).toBe(before);
  });

  it("refuses ambiguous raw matches in a coarse section", async () => {
    const view = readingView(`Intro\n${rowHeader}\nAfter`);
    const section = view.sections[0]!.element;
    section.append(section.firstElementChild!.cloneNode(true));
    const before = view.root.innerHTML;
    view.process();
    await settled();
    expect(view.root.innerHTML).toBe(before);
  });

  it("does not bridge extra prose between a header fragment and native table", async () => {
    const view = readingView(multiHeader);
    view.sections[0]!.element.querySelector("p")!.append(document.createElement("br"), "Keep");
    const before = view.root.innerHTML;
    view.process();
    await settled();
    expect(view.root.innerHTML).toBe(before);
  });

  it.each(["barrier", "text", "reorder"])("revalidates sibling adjacency after a deferred %s change", async (kind) => {
    const view = readingView(multiHeader);
    let release!: () => void;
    const queue = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(MarkdownRenderer.render).mockImplementation(async (...args: unknown[]) => {
      await queue;
      (args[2] as HTMLElement).innerHTML = markdown.render(args[1] as string);
    });
    view.process();
    if (kind === "reorder") view.root.prepend(view.sections[1]!.element);
    else view.sections[0]!.element.after(kind === "text" ? "Keep" : document.createElement("hr"));
    const before = view.root.innerHTML;
    release();
    await settled();
    expect(view.root.innerHTML).toBe(before);
  });

  it("keeps comparison snapshots independent of detached-render cleanup", async () => {
    const view = readingView(`Intro\n${rowHeader}\nAfter`);
    vi.mocked(MarkdownRenderer.render).mockImplementation(async (...args: unknown[]) => {
      const target = args[2] as HTMLElement;
      target.innerHTML = markdown.render(args[1] as string);
      (args[4] as MarkdownRenderChild).register(() => { target.replaceChildren(); });
    });
    view.process();
    await settled();
    expect(view.root.querySelectorAll(".structural-tables-table")).toHaveLength(1);
    expect(view.root.querySelector("tbody th")?.textContent?.trim()).toBe("North");
  });

  it("leaves native output intact when comparison rendering fails", async () => {
    const view = readingView(`Intro\n${rowHeader}`);
    vi.mocked(MarkdownRenderer.render).mockRejectedValue(new Error("Renderer unavailable"));
    const before = view.root.innerHTML;
    view.process();
    await settled();
    expect(view.root.innerHTML).toBe(before);
  });

  it("tolerates host direction annotations while native comparison is pending", async () => {
    const view = readingView(`**Intro**\n${rowHeader}\nAfter`);
    vi.mocked(MarkdownRenderer.render).mockImplementation(async (...args: unknown[]) => {
      (args[2] as HTMLElement).innerHTML = markdown.render(args[1] as string);
      for (const paragraph of view.root.querySelectorAll("p")) paragraph.setAttribute("dir", "auto");
    });
    view.process();
    await settled();
    expect(view.root.querySelectorAll(".structural-tables-table")).toHaveLength(1);
    expect(view.root.textContent).toContain("Intro");
    expect(view.root.textContent).toContain("After");
  });

  it.each([rowHeader.replace("North", "[North](wanted.md)"), multiHeader.replace("E", "[E](wanted.md)")])(
    "refuses identical visible labels with a different link destination", async (table) => {
      const view = readingView(`Intro\n${table}`);
      view.root.querySelector("a")!.setAttribute("href", "other.md");
      const before = view.root.innerHTML;
      view.process();
      await settled();
      expect(view.root.innerHTML).toBe(before);
    },
  );

  it("refuses a raw substring that no longer starts on its own rendered line", async () => {
    const view = readingView(`Intro\n${rowHeader}\nAfter`);
    view.root.querySelector("br")!.replaceWith(" ");
    const paragraph = view.root.querySelector("p")!;
    for (const node of paragraph.childNodes) if (node.nodeType === Node.TEXT_NODE) node.textContent = node.textContent!.replace(/^\n/u, "");
    const before = view.root.innerHTML;
    view.process();
    await settled();
    expect(view.root.innerHTML).toBe(before);
  });

  it("keeps identical tables in separate previews independent", async () => {
    const processor = new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS);
    const left = readingView(multiHeader, processor);
    const right = readingView(multiHeader, processor);
    left.process([0]); right.process([1]);
    await settled();
    expect(left.root.querySelector(".structural-tables-table")).toBeNull();
    expect(right.root.querySelector(".structural-tables-table")).toBeNull();
    left.process([1]); right.process([0]);
    await settled();
    expect(left.root.querySelectorAll(".structural-tables-table")).toHaveLength(1);
    expect(right.root.querySelectorAll(".structural-tables-table")).toHaveLength(1);
  });

  it.each(["unload", "source", "DOM", "disabled"])("abandons deferred work after %s changes", async (kind) => {
    let enabled = true;
    const processor = new StructuralTableReadingProcessor({} as App, () => ({ ...DEFAULT_SETTINGS, enableReadingView: enabled }));
    const view = readingView(`Intro\n${rowHeader}\nAfter`, processor);
    let release!: () => void;
    const queue = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(MarkdownRenderer.render).mockImplementation(async (...args: unknown[]) => {
      await queue;
      (args[2] as HTMLElement).innerHTML = markdown.render(args[1] as string);
    });
    view.process();
    if (kind === "unload") view.children.forEach((child) => child.unload());
    if (kind === "source") view.state.source += "Changed";
    if (kind === "DOM") view.root.querySelector("p")!.append("Changed");
    if (kind === "disabled") enabled = false;
    const before = view.root.innerHTML;
    release();
    await settled();
    expect(view.root.innerHTML).toBe(before);
  });

  it("owns deferred cells with the replacement rather than a removed source paragraph", async () => {
    const view = readingView(`Intro\n${rowHeader}\nAfter`);
    view.process();
    await settled();
    for (const child of view.children) if (!view.root.contains(child.containerEl)) child.unload();
    expect(view.root.querySelector("tbody th")?.textContent?.trim()).toBe("North");
    expect(view.children.filter((child) => child.containerEl.classList.contains("structural-tables-container"))).toHaveLength(1);
  });
});
