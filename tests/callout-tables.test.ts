// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEditableTables } from "../src/core/parser";
import { calloutRanges, withoutSourcePrefixes } from "../src/core/source-lines";
import { blockSignature, calloutBlocks, matchingBlocks, renderTableSignatures } from "../src/rendering/native-table-mapping";
import { CalloutTables } from "../src/editor/callout-tables";
import type { StructuralTableWidget } from "../src/editor/table-widget";
import MarkdownIt from "markdown-it";
import { type App, MarkdownRenderer } from "obsidian";

const tableSource = "> | A | < |\n> | --- | --- |\n> | x | y |";
const tableHtml = "<table><thead><tr><th>A</th><th>&lt;</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table>";
const rawSource = "> | Name | Value |\n> | --- || --- |\n> | **Software** | Apps |";
const rawHtml = "<p>| Name | Value |<br>\n| --- || --- |<br>\n| <strong>Software</strong> | Apps |</p>";
const cleanups: (() => void)[] = [];

function element(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.firstElementChild as HTMLElement;
}

function mount(source: string, html: string, pending?: Promise<string[]>, detached = false,
  outside = "End"): { view: EditorView; manager: CalloutTables; root: HTMLElement; render: ReturnType<typeof vi.fn> } {
  class Native extends WidgetType {
    toDOM(): HTMLElement { return element(`<div class="callout"><div class="callout-content">${html}</div></div>`); }
  }
  const doc = `> [!custom]+ Test\n${source}\n\n${outside}`;
  const native = EditorView.decorations.of(Decoration.set([
    Decoration.replace({ widget: new Native(), block: true }).range(0, doc.indexOf("\n\n")),
  ]));
  const parent = document.createElement("div");
  if (!detached) document.body.appendChild(parent);
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [native] }), parent });
  const render = vi.fn(async (table) => pending ?? [blockSignature(element(table.rowHeaderColumnCount > 0 ? rawHtml : tableHtml))]);
  const manager = new CalloutTables(view, () => ({
    tables: parseEditableTables(view.state.doc.toString()).tables,
    ranges: calloutRanges(view.state.doc.toString()), sourcePath: "Test.md", owns: (table) => table.valid, render,
    widget: (table) => ({
      toDOM: () => element(`<div class="structural-tables-live-preview" data-from="${table.range.from}">Owned</div>`),
      updateDOM: () => true, destroy: () => {},
    }) as unknown as StructuralTableWidget,
  }));
  cleanups.push(() => { manager.destroy(); view.destroy(); parent.remove(); });
  return { view, manager, root: parent, render };
}

function mountMarkdownCallout(source: string, html: string, outside?: string) {
  const renderer = new MarkdownIt();
  vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, note, target) => {
    target.innerHTML = renderer.render(note);
  });
  const fixture = mount(source, html, undefined, false, outside);
  fixture.render.mockImplementation((table, includeNoteReferences = true) =>
    renderTableSignatures({} as App, table, "Test.md", document, includeNoteReferences));
  return fixture;
}

afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

describe("source-owned callout mounting", () => {
  it.each([false, true])("matches two exact tables when native Callout resolves note references: %s", async (nativeHasReferences) => {
    const markdown = new MarkdownIt();
    const definition = "[id]: https://example.org/second";
    const source = ["> | Label | Reference | Direct |", "> | --- || --- | --- |",
      "> | A B | [Guide][id] | [Guide](https://example.org/first) |", ">",
      "> | Label | Reference | Direct |", "> | --- || --- | --- |",
      "> | AB | [Guide][id] | [Guide](https://example.org/first) |"].join("\n");
    const html = markdown.render((nativeHasReferences ? definition + "\n\n" : "") + withoutSourcePrefixes(source));
    const { manager, root, render } = mountMarkdownCallout(source, html, definition);
    await vi.waitFor(() => expect(manager.diagnostics.map(item => item.state)).toEqual(["mounted", "mounted"]));
    expect(root.querySelectorAll(".structural-tables-live-preview")).toHaveLength(2);
    expect(render.mock.calls.filter(call => call[1] === false)).toHaveLength(2);
  });

  it.each([["| --- | --- |", "<"], ["| --- || --- |", "Value"]])(
    "keeps an unrelated native link when a callout table with %s has the same label", async (delimiter, cell) => {
      const md = new MarkdownIt();
      const source = ["> | Guide | " + cell + " |", "> " + delimiter, "> | [Open](/wanted) | Y |"].join("\n");
      const renderBlock = (note: string) => md.render(withoutSourcePrefixes(note));
      const { manager, root } = mountMarkdownCallout(source, renderBlock(source.replace("/wanted", "/other")));
      await vi.waitFor(() => expect(manager.diagnostics[0]?.state).toBe("unmatched"));
      expect(root.querySelector("a")?.getAttribute("href")).toBe("/other");
      expect(root.querySelector(".structural-tables-live-preview")).toBeNull();
    },
  );

  it("accepts host line breaks in a raw callout block while checking its link", async () => {
    const source = rawSource.replace("Apps", "[Open](/wanted)");
    const html = new MarkdownIt({ breaks: true }).render(withoutSourcePrefixes(source));
    const { manager } = mountMarkdownCallout(source, html);
    await vi.waitFor(() => expect(manager.diagnostics[0]?.state).toBe("mounted"));
  });

  it("classifies many offscreen tables in source order with a linear number of range reads", async () => {
    const count = 40;
    const source = "Introduction\n\n" + Array.from({ length: count }, (_, index) =>
      `> [!note] ${index}\n${tableSource}\n`).join("\n");
    const tables = parseEditableTables(source).tables;
    let reads = 0;
    const ranges = calloutRanges(source).map(({ from, to }) => ({
      get from(): number { reads += 1; return from; },
      get to(): number { reads += 1; return to; },
    }));
    const view = new EditorView({ state: EditorState.create({ doc: source }) });
    vi.spyOn(view, "viewport", "get").mockReturnValue({ from: 0, to: 1 });
    const manager = new CalloutTables(view, () => ({
      tables, ranges, sourcePath: "Many.md", owns: (table) => table.valid && table.structural,
      render: () => { throw new Error("Unexpected offscreen render"); },
      widget: () => { throw new Error("Unexpected offscreen mount"); },
    }));
    cleanups.push(() => { manager.destroy(); view.destroy(); });
    await Promise.resolve();
    expect(tables).toHaveLength(count);
    expect(manager.diagnostics).toEqual(tables.map(({ range }) => ({ ...range, state: "waiting-for-dom" })));
    expect(reads).toBeLessThan(12 * count);
  });

  it("keeps one owned host while constructing a detached editor and after attachment", async () => {
    const { root, manager, render } = mount(tableSource, tableHtml, undefined, true);
    await vi.waitFor(() => expect(manager.diagnostics[0]?.state).toBe("mounted"));
    const host = root.querySelector(".structural-tables-live-preview");
    expect(host?.isConnected).toBe(false);
    for (let index = 0; index < 10; index += 1) {
      manager.schedule();
      await Promise.resolve();
      expect(root.querySelector(".structural-tables-live-preview")).toBe(host);
    }
    document.body.appendChild(root);
    manager.schedule();
    await Promise.resolve();
    expect(root.querySelector(".structural-tables-live-preview")).toBe(host);
    expect(render).toHaveBeenCalledOnce();
  });

  it("preserves wrapper content around one owned native table", async () => {
    const wrapped = `<ul><li><span class="keep-intro">Keep intro</span>${tableHtml}<span class="keep-tail">Keep tail</span></li></ul>`;
    const { root, manager } = mount(tableSource, wrapped);
    await vi.waitFor(() => expect(manager.diagnostics[0]?.state).toBe("mounted"));

    expect(root.querySelector(".keep-intro")?.textContent).toBe("Keep intro");
    expect(root.querySelector(".keep-tail")?.textContent).toBe("Keep tail");
    expect(root.querySelector("li > .structural-tables-live-preview")).not.toBeNull();

    manager.destroy();
    expect(root.querySelector(".keep-intro")?.textContent).toBe("Keep intro");
    expect(root.querySelector(".keep-tail")?.textContent).toBe("Keep tail");
    expect(root.querySelector("li > table")?.textContent).toBe("A<xy");
  });

  it("retains a temporarily detached editor's host without release/remount feedback", async () => {
    const { root, manager } = mount(tableSource, tableHtml);
    await vi.waitFor(() => expect(manager.diagnostics[0]?.state).toBe("mounted"));
    const host = root.querySelector(".structural-tables-live-preview");
    root.remove();
    manager.schedule();
    await Promise.resolve();
    expect(root.querySelector(".structural-tables-live-preview")).toBe(host);
    document.body.appendChild(root);
    manager.destroy();
    expect(root.querySelector(".structural-tables-live-preview")).toBeNull();
    expect(root.querySelector("table")?.textContent).toBe("A<xy");
  });

  it("does not take a callout ancestor outside its own editor", async () => {
    const { root, view, manager, render } = mount(tableSource, "");
    const outer = element(`<div class="callout"><div class="callout-content">${tableHtml}</div></div>`);
    document.body.appendChild(outer);
    outer.appendChild(root);
    vi.spyOn(view, "domAtPos").mockReturnValue({ node: view.dom, offset: 0 });
    await vi.waitFor(() => expect(manager.diagnostics[0]?.state).toBe("waiting-for-dom"));
    expect(render).not.toHaveBeenCalled();
    expect(outer.querySelector("table")).not.toBeNull();
    expect(outer.querySelector(".structural-tables-live-preview")).toBeNull();
    outer.remove();
  });

  it("does not take a callout from another editor or note embed", async () => {
    const { root, view, manager } = mount(tableSource, "");
    const foreign = element(`<div class="cm-editor"><div class="callout"><div class="callout-content">${tableHtml}</div></div></div>`);
    root.appendChild(foreign);
    vi.spyOn(view, "domAtPos").mockReturnValue({ node: foreign, offset: 0 });
    await vi.waitFor(() => expect(manager.diagnostics[0]?.state).toBe("waiting-for-dom"));
    expect(foreign.querySelector("table")).not.toBeNull();
    view.dom.appendChild(foreign);
    manager.schedule();
    await Promise.resolve();
    expect(foreign.querySelector(".structural-tables-live-preview")).toBeNull();
    foreign.className = "internal-embed";
    manager.schedule();
    await Promise.resolve();
    expect(foreign.querySelector(".structural-tables-live-preview")).toBeNull();
  });
  it("does not depend on reverse DOM position mapping", async () => {
    const { view, root, manager } = mount(tableSource, tableHtml);
    vi.spyOn(view, "posAtDOM").mockImplementation(() => { throw new Error("native widget mapping unavailable"); });
    await vi.waitFor(() => expect(root.querySelectorAll(".structural-tables-live-preview")).toHaveLength(1));
    expect(manager.diagnostics[0]?.state).toBe("mounted");
  });

  it("binds rich raw row headers and a later native table independently", async () => {
    const { root, manager, render } = mount(`${rawSource}\n>\n${tableSource}`, rawHtml + tableHtml);
    await vi.waitFor(() => expect(root.querySelectorAll(".structural-tables-live-preview")).toHaveLength(2));
    expect(manager.diagnostics.map((item) => item.state)).toEqual(["mounted", "mounted"]);
    manager.schedule();
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(2);
    manager.destroy();
    expect(root.querySelector("strong")?.textContent).toBe("Software");
    expect(root.querySelector("table")?.textContent).toBe("A<xy");
  });

  it("does not consume a different table when one target is missing", async () => {
    const { root, manager } = mount(`${rawSource}\n>\n${tableSource}`, tableHtml);
    await vi.waitFor(() => expect(manager.diagnostics.map((item) => item.state)).toEqual(["unmatched", "mounted"]));
    expect(root.querySelectorAll(".structural-tables-live-preview")).toHaveLength(1);
  });

  it("refuses ambiguous identical targets instead of guessing an edit destination", async () => {
    const { root, manager } = mount(tableSource, tableHtml + tableHtml);
    await vi.waitFor(() => expect(manager.diagnostics[0]?.state).toBe("ambiguous"));
    expect(root.querySelectorAll("table")).toHaveLength(2);
    expect(root.querySelector(".structural-tables-live-preview")).toBeNull();
  });

  it("binds two identical source tables only when the complete target count agrees", async () => {
    const { root, manager } = mount(`${tableSource}\n>\n${tableSource}`, tableHtml + tableHtml);
    await vi.waitFor(() => expect(manager.diagnostics.map((item) => item.state)).toEqual(["mounted", "mounted"]));
    const positions = [...root.querySelectorAll<HTMLElement>(".structural-tables-live-preview")].map((host) => Number(host.dataset.from));
    expect(positions[0]).toBeLessThan(positions[1]!);
  });

  it("retries after the host inserts a delayed target", async () => {
    const { root, manager } = mount(tableSource, "");
    await vi.waitFor(() => expect(manager.diagnostics[0]?.state).toBe("unmatched"));
    root.querySelector(".callout-content")!.appendChild(element(tableHtml));
    await vi.waitFor(() => expect(manager.diagnostics[0]?.state).toBe("mounted"));
  });

  it("does not mount after disposal while native rendering was pending", async () => {
    let resolve!: (value: string[]) => void;
    const pending = new Promise<string[]>((done) => { resolve = done; });
    const { root, manager } = mount(tableSource, tableHtml, pending);
    await vi.waitFor(() => expect(manager.diagnostics[0]?.state).toBe("rendering"));
    manager.destroy();
    resolve([blockSignature(element(tableHtml))]);
    await pending;
    await Promise.resolve();
    expect(root.querySelector(".structural-tables-live-preview")).toBeNull();
  });
});

describe("native block matching", () => {
  it.each([
    ['<a href="/report" title="Annual">Guide</a>', '<a href="/report" title="Monthly">Guide</a>'],
    ['<img src="first.png" alt="Chart">', '<img src="second.png" alt="Chart">'],
  ])("preserves distinguishable inline content in native blocks", (source, rendered) => {
    const target = element("<p>" + rendered + "</p>");
    const root = element('<div class="callout"><div class="callout-content"></div></div>');
    root.firstElementChild!.append(target);
    const blocks = calloutBlocks(root, new Map());
    expect(matchingBlocks(blocks, [blockSignature(element("<p>" + source + "</p>"))])).toEqual([]);
    expect(matchingBlocks(blocks, [blockSignature(target)])).toEqual([[target]]);
  });

  it("never treats another manager's mounted host as native table content", () => {
    const root = element(`<div class="callout"><div class="callout-content"><div class="structural-tables-live-preview">${tableHtml}</div></div></div>`);
    const host = root.querySelector<HTMLElement>(".structural-tables-live-preview")!;
    const original = element(tableHtml);
    expect(calloutBlocks(root, new Map())).toEqual([]);
    expect(matchingBlocks(calloutBlocks(root, new Map([[host, [original]]])), [blockSignature(original)])).toEqual([[host]]);
  });
  it("returns the table rather than a wrapper that contains unrelated content", () => {
    const root = element(`<div class="callout"><div class="callout-content"><ul><li><span>Keep intro</span>${tableHtml}<span>Keep tail</span></li></ul></div></div>`);
    const table = root.querySelector("table")!;
    const matches = matchingBlocks(calloutBlocks(root, new Map()), [blockSignature(table)]);
    expect(matches).toEqual([[table]]);
  });

  it("preserves document order across outer and nested identical tables", () => {
    const root = element(`<div class="callout"><div class="callout-content">${tableHtml}<div class="callout"><div class="callout-content">${tableHtml}</div></div>${tableHtml}</div></div>`);
    const native = [...root.querySelectorAll("table")];
    const matches = matchingBlocks(calloutBlocks(root, new Map()), [blockSignature(native[0]!)]);
    expect(matches.map((match) => match[0])).toEqual(native);
  });
  it("does not count a nested callout as a second copy of its table", () => {
    const root = element(`<div class="callout"><div class="callout-content"><div class="callout"><div class="callout-content">${tableHtml}</div></div></div></div>`);
    expect(matchingBlocks(calloutBlocks(root, new Map()), [blockSignature(element(tableHtml))])).toHaveLength(1);
  });
  it("matches multi-block table output without crossing unrelated content", () => {
    const first = "<p>| <strong>Heading</strong> | &lt; |</p>";
    const root = element(`<div class="callout"><div class="callout-content">${first}${tableHtml}<pre>ignored</pre>${first}</div></div>`);
    const matches = matchingBlocks(calloutBlocks(root, new Map()), [blockSignature(element(first)), blockSignature(element(tableHtml))]);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toHaveLength(2);
  });

  it("excludes a note embed even when its table has identical content", () => {
    const root = element(`<div class="callout"><div class="callout-content"><div class="internal-embed"><div class="callout"><div class="callout-content">${tableHtml}</div></div></div></div></div>`);
    expect(matchingBlocks(calloutBlocks(root, new Map()), [blockSignature(element(tableHtml))])).toHaveLength(0);
  });
});
