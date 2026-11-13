// @vitest-environment happy-dom

import { type App, MarkdownRenderer, type MarkdownPostProcessorContext } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/config/settings";
import * as parser from "../src/core/parser";
import { StructuralTableReadingProcessor } from "../src/reading/table-postprocessor";

const ordinary = "| Name | Value |\n| --- | --- |\n| Native | 10 |";
const structural = "| Name | Value |\n| --- || --- |\n| Alpha | 10 |";

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

function section(processor: StructuralTableReadingProcessor, text: string, options: {
  docId?: string;
  sourcePath?: string;
  lineStart?: number;
  lineEnd?: number;
  raw?: string;
} = {}) {
  const container = document.createElement("div");
  const original = container.appendChild(document.createElement(options.raw === undefined ? "table" : "p"));
  if (options.raw === undefined) {
    original.innerHTML = "<thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Native</td><td>10</td></tr></tbody>";
  } else {
    options.raw.split(/\r\n|\r|\n/gu).forEach((line, index) => {
      if (index > 0) original.appendChild(document.createElement("br"));
      original.append(line);
    });
  }
  const context = {
    docId: options.docId ?? "reading-cache-test",
    sourcePath: options.sourcePath ?? "Reading.md",
    addChild: vi.fn(),
    getSectionInfo: () => ({ text, lineStart: options.lineStart ?? 0, lineEnd: options.lineEnd ?? 2 }),
  } as unknown as MarkdownPostProcessorContext;
  processor.process(container, context);
  return { container, original, context };
}

afterEach(() => vi.restoreAllMocks());

describe("Reading source snapshots", () => {
  it("parses an unchanged whole note once across separate section contexts with ordinary takeover disabled", () => {
    const count = 100;
    const source = Array.from({ length: count }, () => ordinary).join("\n\n");
    const parse = vi.spyOn(parser, "parseEditableTables");
    const processor = new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS);

    for (let index = 0; index < count; index += 1) {
      const { container, original, context } = section(processor, source, {
        lineStart: index * 4, lineEnd: index * 4 + 2,
      });
      expect(original.parentElement).toBe(container);
      expect(context.addChild).not.toHaveBeenCalled();
      expect(container.querySelector(".structural-tables-container")).toBeNull();
    }

    expect(parse).toHaveBeenCalledExactlyOnceWith(source);
  });

  it("reparses changed source and renders the current cell content without changing an earlier section", async () => {
    const parse = vi.spyOn(parser, "parseEditableTables");
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, element) => {
      element.textContent = source;
    });
    const processor = new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS);
    const first = section(processor, structural, { raw: structural });
    const changed = structural.replace("Alpha", "Beta");
    const second = section(processor, changed, { raw: changed });
    const repeated = section(processor, changed, { raw: changed });

    await vi.waitFor(() => {
      expect(first.container.querySelector("tbody")?.textContent).toBe("Alpha10");
      expect(second.container.querySelector("tbody")?.textContent).toBe("Beta10");
      expect(repeated.container.querySelector("tbody")?.textContent).toBe("Beta10");
    });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse).toHaveBeenNthCalledWith(1, structural);
    expect(parse).toHaveBeenNthCalledWith(2, changed);
  });

  it.each([["```", "```"], ["<pre>", "</pre>"], ["<!--", "-->"], ["$$", "$$"]])(
    "invalidates unchanged table lines when surrounding %s protection changes",
    (opening, closing) => {
      const parse = vi.spyOn(parser, "parseEditableTables");
      const processor = new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS);
      const source = `Intro\n${structural}\n`;
      const protectedSource = `${opening}\n${structural}\n${closing}`;
      const options = { lineStart: 1, lineEnd: 3, raw: structural };

      expect(section(processor, source, options).container.querySelector(".structural-tables-table")).not.toBeNull();
      const protectedSection = section(processor, protectedSource, options);
      expect(protectedSection.original.parentElement).toBe(protectedSection.container);
      expect(protectedSection.context.addChild).not.toHaveBeenCalled();
      expect(section(processor, source, options).container.querySelector(".structural-tables-table")).not.toBeNull();
      expect(parse.mock.calls.map(([text]) => text)).toEqual([source, protectedSource, source]);
    },
  );

  it.each(["docId", "sourcePath"] as const)("isolates %s identities while reusing interleaved views", (key) => {
    const parse = vi.spyOn(parser, "parseEditableTables");
    const processor = new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS);
    section(processor, ordinary);
    section(processor, ordinary, { [key]: "Other" });
    section(processor, ordinary);
    section(processor, ordinary, { [key]: "Other" });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("does not retain the source history of every visited note", () => {
    const parse = vi.spyOn(parser, "parseEditableTables");
    const processor = new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS);
    for (let index = 0; index < 100; index += 1) {
      section(processor, ordinary, { sourcePath: `Note-${index}.md` });
    }
    section(processor, ordinary, { sourcePath: "Note-99.md" });
    expect(parse).toHaveBeenCalledTimes(100);
    section(processor, ordinary, { sourcePath: "Note-0.md" });
    expect(parse).toHaveBeenCalledTimes(101);
  });

  it.each(["\n", "\r\n", "\r"])("preserves section bounds for %j line endings", (ending) => {
    const processor = new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS);
    const source = `Intro\n\n${structural}`.replace(/\n/gu, ending);
    const raw = structural.replace(/\n/gu, ending);
    const rendered = section(processor, source, { lineStart: 2, lineEnd: 100, raw });
    expect(rendered.container.querySelector(".structural-tables-table")).not.toBeNull();
    const outside = section(processor, source, { lineStart: 5, lineEnd: 100, raw });
    expect(outside.original.parentElement).toBe(outside.container);
    expect(outside.context.addChild).not.toHaveBeenCalled();
  });

  it.each([[-1, 2], [0, -1], [2, 1], [0.5, 2], [0, 1.5], [NaN, 2], [0, Infinity], [3, 3], [100, 101]])(
    "rejects invalid section bounds %s..%s before parsing",
    (lineStart, lineEnd) => {
      const parse = vi.spyOn(parser, "parseEditableTables");
      const processor = new StructuralTableReadingProcessor({} as App, () => DEFAULT_SETTINGS);
      const view = section(processor, structural, { lineStart, lineEnd, raw: structural });
      expect(view.original.parentElement).toBe(view.container);
      expect(view.context.addChild).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
    },
  );
});
