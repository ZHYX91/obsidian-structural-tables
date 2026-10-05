// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEditableTables } from "../src/core/parser";
import { calloutRanges } from "../src/core/source-lines";
import { blockSignature, calloutBlocks, matchingBlocks } from "../src/rendering/native-table-mapping";
import { CalloutTables } from "../src/editor/callout-tables";
import type { StructuralTableWidget } from "../src/editor/table-widget";

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

function mount(source: string, html: string, pending?: Promise<string[]>, detached = false): { view: EditorView; manager: CalloutTables; root: HTMLElement; render: ReturnType<typeof vi.fn> } {
  class Native extends WidgetType {
    toDOM(): HTMLElement { return element(`<div class="callout"><div class="callout-content">${html}</div></div>`); }
  }
  const doc = `> [!custom]+ Test\n${source}\n\nEnd`;
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

afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

describe("source-owned callout mounting", () => {
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
