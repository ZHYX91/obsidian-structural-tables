// @vitest-environment happy-dom
import { Prec, StateField, Transaction } from "@codemirror/state";
import { history, redo, undo } from "@codemirror/commands";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import MarkdownIt from "markdown-it";
import { App, MarkdownRenderer } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { StructuralTable } from "../src/core/model";
import { parseEditableTables } from "../src/core/parser";
import { blockSignature, renderTableSignatures } from "../src/rendering/native-table-mapping";
import { CalloutFallbackWidget } from "../src/editor/callout-fallback-widget";
import { dispatchScopeCaptureThenDom, lastMenu, setMockModKey } from "./mocks/obsidian";
import {
  NativeTableWidget,
  NativeCalloutWidget,
  nativeTableForSource,
  SourceCalloutWidget,
  screenshotTable,
  mountEditor,
  replaceDraftText,
  dispatchDraftShortcut,
  dispatchPointerDown,
} from "./helpers/live-preview-editor";

describe("Live Preview rendering and source ownership", () => {
  it("tracks references used only by the native block or only by individual cells", async () => {
    // Native Markdown sees one reference spanning the first row's pipe. Its
    // multiline code span hides a second reference that the structural cell renders.
    const table = ["| --- || --- |", "| [split | name] |", "| ` | A |", "| [Cell][r] | B |", "| ` | C |"].join("\n");
    const definitions = "[split | name]: /native\n[r]: /first\n[unused]: /other";
    const note = "Intro\n\n" + table + "\n\n" + definitions;
    const md = new MarkdownIt();
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, element) => {
      element.innerHTML = md.render(source);
    });
    const { app, parent, view } = mountEditor(note, { anchor: 0 });
    try {
      const source = parseEditableTables(note).tables[0]!;
      const native = document.createElement("div");
      native.innerHTML = md.render(table + "\n\n" + definitions);
      expect(native.querySelector("a")?.getAttribute("href")).toBe("/native");
      expect(native.querySelector("code")?.textContent).toContain("[Cell][r]");
      expect(await renderTableSignatures(app, source, "Note.md", document))
        .toEqual(Array.from(native.children, child => blockSignature(child as HTMLElement)));

      const link = () => parent.querySelector(".structural-tables-table a");
      await vi.waitFor(() => expect(link()?.getAttribute("href")).toBe("/first"));
      const initial = link();
      const replace = (from: string, to: string): void => {
        const offset = view.state.doc.toString().indexOf(from);
        view.dispatch({ changes: { from: offset, to: offset + from.length, insert: to } });
      };
      replace("/other", "/unrelated");
      expect(link()).toBe(initial);
      replace("/first", "/updated");
      await vi.waitFor(() => expect(link()?.getAttribute("href")).toBe("/updated"));
    } finally { view.destroy(); }
  });

  it.each([
    { before: "text", after: "<div>", beforeCount: 1, afterCount: 0 },
    { before: "<div>", after: "text", beforeCount: 0, afterCount: 1 },
  ])("updates table ownership after $before becomes $after", ({ before, after, beforeCount, afterCount }) => {
    const source = `${before}\n| A | < |\n| --- | --- |\n| x | y |`;
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      expect(parent.querySelectorAll(".structural-tables-live-preview")).toHaveLength(beforeCount);
      view.dispatch({ changes: { from: 0, to: before.length, insert: after } });
      const complete = parseEditableTables(view.state.doc.toString()).tables;
      expect(complete).toHaveLength(afterCount);
      expect(parent.querySelectorAll(".structural-tables-live-preview")).toHaveLength(complete.length);
    } finally { view.destroy(); }
  });

  it("renders and edits a source-owned Callout when native HTML lexing leaves it raw", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, markdown, target) => {
      const native = nativeTableForSource(markdown, target.ownerDocument);
      if (markdown.startsWith("> [!note]")) {
        const shell = new SourceCalloutWidget(markdown).toDOM();
        shell.querySelector(".callout-title")!.textContent = "Boundary control";
        shell.querySelector(".callout-content")!.prepend(Object.assign(document.createElement("p"), { textContent: "Keep intro" }));
        shell.querySelector(".callout-content")!.append(Object.assign(document.createElement("p"), { textContent: "Keep tail" }));
        target.appendChild(shell);
      } else if (native !== null) target.appendChild(native);
      else target.textContent = markdown;
    });
    const prefix = 'Intro\n\n## HTML\n<span id="keep">\n| literal | < |\n</span>\n\n';
    const source = prefix + "> [!note] Boundary control\n> Keep intro\n>\n> | A | < |\n> | --- | --- |\n> | x | y |\n>\n> Keep tail\n\nEnd";
    const { view, parent } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-callout-fallback .structural-tables-live-preview")).not.toBeNull());
      expect(view.state.doc.toString()).toBe(source);
      expect(parent.querySelector(".callout-content")?.textContent).toContain("Keep intro");
      expect(parent.querySelector(".callout-content")?.textContent).toContain("Keep tail");
      const cell = parent.querySelector<HTMLElement>(".callout [data-structural-row='1'][data-structural-column='0']")!;
      dispatchPointerDown(cell, "mouse");
      cell.click();
      await vi.waitFor(() => expect(parent.querySelector("textarea")).not.toBeNull());
      replaceDraftText(parent.querySelector("textarea")!, "changed");
      parent.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      await vi.waitFor(() => expect(view.state.doc.toString()).toContain("changed"));
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-table")?.textContent).toContain("changed"));
      const after = view.state.doc.toString();
      expect(after.startsWith(prefix + "> [!note] Boundary control\n> Keep intro\n>\n")).toBe(true);
      expect(after.endsWith(">\n> Keep tail\n\nEnd")).toBe(true);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-table")?.textContent).toContain("x"));
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(after);
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-table")?.textContent).toContain("changed"));
    } finally { view.destroy(); }
  });

  it("returns the complete fallback Callout to source and resumes after leaving it", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, markdown, target) => {
      if (markdown.startsWith("> [!note]")) target.appendChild(new SourceCalloutWidget(markdown).toDOM());
      else {
        const native = nativeTableForSource(markdown, target.ownerDocument);
        if (native !== null) target.appendChild(native);
      }
    });
    const source = "Intro\n\n> [!note] Title\n> | A | < |\n> | --- | --- |\n> | x | y |\n\nEnd";
    const { view, parent } = mountEditor(source, { anchor: 0 });
    try {
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-callout-fallback .callout-title")).not.toBeNull());
      parent.querySelector(".callout-title")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      expect(view.state.selection.main.from).toBe(source.indexOf("> [!note]"));
      expect(parent.querySelector(".structural-tables-callout-fallback")).toBeNull();
      expect(view.state.doc.toString()).toBe(source);
      view.dispatch({ selection: { anchor: 0 } });
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-callout-fallback .structural-tables-live-preview")).not.toBeNull());
      view.dispatch({ changes: { from: 0, insert: "Before\n" } });
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-callout-fallback .structural-tables-live-preview")).not.toBeNull());
      expect(view.state.doc.toString()).toBe("Before\n" + source);
    } finally { view.destroy(); }
  });

  it.each([
    "```md\n> [!note]\n> | A | < |\n> | --- | --- |\n> | x | y |\n```",
    "<div>\n> [!note]\n> | A | < |\n> | --- | --- |\n> | x | y |\n</div>",
    "> [!note]\n> | A | B |\n> | --- | --- |\n> | x | y |",
    "> [!note]\n> | A | ^ |\n> | --- | --- |\n> | x | y |",
  ])("does not acquire protected, ordinary or invalid raw Callout text: %s", async (body) => {
    const source = "Intro\n\n" + body + "\n\nEnd";
    const { view, parent } = mountEditor(source, { anchor: 0 });
    try {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
      expect(parent.querySelector(".structural-tables-callout-fallback")).toBeNull();
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each(["reject", "destroy", "not-callout"] as const)("keeps fallback source safe during %s native rendering", async (mode) => {
    let complete!: () => void;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, _markdown, target) => {
      await new Promise<void>((resolve) => { complete = resolve; });
      if (mode === "reject") throw new Error("render failed");
      target.innerHTML = mode === "not-callout" ? "<p>Other</p>" : "<div class='callout'>Late</div>";
    });
    const { view } = mountEditor("Intro", { anchor: 0 });
    const widget = new CalloutFallbackWidget(new App(), 0, "> [!note] Keep complete source", "Test.md");
    const host = widget.toDOM(view);
    try {
      expect(host.textContent).toBe(widget.source);
      if (mode === "destroy") widget.destroy(host);
      complete();
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
      expect(host.textContent).toBe(widget.source);
    } finally { widget.destroy(host); view.destroy(); }
  });

  it.each(["above", "below"] as const)("keeps column controls inside the table beside an external %s block caption", (placement) => {
    const source = "Before\n\nTable: Q\n\n| Region | Value |\n| --- | --- |\n| North | 10 |\n| ^ | 20 |\n\nAfter";
    const table = parseEditableTables(source).tables[0]!;
    class ExternalCaption extends WidgetType {
      override toDOM(): HTMLElement {
        const element = document.createElement("span");
        element.className = "external-caption";
        element.textContent = "Table 1: Q";
        return element;
      }
    }
    const captions = StateField.define({
      create: () => Decoration.set([
        Decoration.widget({ widget: new ExternalCaption(), block: true, side: placement === "above" ? -10_000 : 10_000 })
          .range(placement === "above" ? table.range.from : table.range.to),
      ]),
      update: (value) => value,
      provide: (field) => EditorView.decorations.from(field),
    });
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("structural-tables-live-preview")) return new DOMRect(0, 80, 300, 200);
      if (this.classList.contains("structural-tables-table")) return new DOMRect(0, 80, 200, 180);
      if (this.classList.contains("external-caption")) return new DOMRect(0, placement === "above" ? 44 : 264, 100, 32);
      return originalRect.call(this);
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [captions]);
    try {
      const caption = parent.querySelector<HTMLElement>(".external-caption")!;
      const host = parent.querySelector<HTMLElement>(".structural-tables-live-preview")!;
      const rendered = host.querySelector<HTMLTableElement>("table")!;
      expect(caption.closest(".structural-tables-live-preview")).toBeNull();
      expect(rendered.caption?.getAttribute("aria-hidden")).toBe("true");
      expect(rendered.caption?.textContent).toBe("");
      expect(rendered.rows.length).toBe(table.rows.length);
      const handle = host.querySelector<HTMLElement>(".structural-tables-column-handle")!;
      const top = host.getBoundingClientRect().top + Number.parseFloat(handle.style.getPropertyValue("inset-block-start"));
      expect(top).toBe(rendered.getBoundingClientRect().top);
      if (placement === "above") expect(top).toBeGreaterThan(caption.getBoundingClientRect().bottom);
      else expect(top + 20).toBeLessThan(caption.getBoundingClientRect().top);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("syncs visual cells to source and hands ownership to raw Markdown only on request", async () => {
    const source = [
      "Before",
      "",
      "| Region | Sales | < |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
      "",
      "End",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      expect(cell).not.toBeNull();
      dispatchPointerDown(cell, "mouse");
      const sourceOffset = source.indexOf("10");
      expect(view.state.selection.main.anchor).toBe(sourceOffset);
      expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
      expect(view.state.doc.toString()).toBe(source);
      expect(parent.textContent).not.toContain("| --- | --- | --- |");

      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const editSource = lastMenu?.items.find((item) => item.title === "Edit table source");
      expect(editSource).toBeDefined();
      editSource?.callback?.();

      await vi.waitFor(() => {
        expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
        expect(view.hasFocus).toBe(true);
        expect(view.state.selection.main.anchor).toBe(sourceOffset);
      });
      expect(view.state.doc.toString()).toBe(source);
      expect(parent.textContent).toContain("| --- | --- | --- |");
    } finally { view.destroy(); }
  });

  it.each(["pointer", "detach"] as const)("releases its own replacement height after rendering despite %s", async (change) => {
    let finish: (() => void) | undefined;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, markdown, target) => {
      if (markdown === "changed-final") await new Promise<void>((resolve) => { finish = resolve; });
      target.textContent = markdown;
    });
    const { parent, view } = mountEditor("Before\n\n| H | V |\n| --- || --- |\n| A | final-cell |\n\nAfter", { anchor: 0 });
    try {
      const host = parent.querySelector<HTMLElement>(".structural-tables-live-preview")!; host.style.boxSizing = "border-box";
      vi.spyOn(host, "getBoundingClientRect").mockReturnValue({ height: 480 } as DOMRect);
      host.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      parent.querySelector<HTMLTextAreaElement>("textarea")!.value = "changed-final";
      document.body.appendChild(document.createElement("button")).focus();
      const replacement = parent.querySelector<HTMLElement>(".structural-tables-live-preview")!;
      expect(replacement).not.toBe(host); expect(replacement.style.minHeight).toBe("480px");
      await vi.waitFor(() => expect(finish).toBeDefined());
      if (change === "pointer") dispatchPointerDown(replacement, "touch"); else parent.remove();
      expect(replacement.style.minHeight).toBe("480px");
      finish!(); await vi.waitFor(() => expect(replacement.style.minHeight).toBe(""));
      if (change === "detach") { document.body.append(parent); view.requestMeasure(); expect(parent.querySelector(".structural-tables-live-preview")).toBe(replacement); }
    } finally { view.destroy(); }
  });

  it("accepts a valid external source edit and rebuilds semantic presentation", async () => {
    const source = [
      "Before",
      "",
      "| Region | Sales | < |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
      "",
      "End",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: source.indexOf("North") });
    try {
      view.focus();
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-live-preview")).toBeNull());

      const value = source.indexOf("10");
      view.dispatch({ changes: { from: value, to: value + 2, insert: "20" } });
      const changed = view.state.doc.toString();
      const parsed = parseEditableTables(changed).tables[0]!;
      expect(parsed.valid).toBe(true);
      expect(parsed.rows[1]?.cells[1]?.content).toBe("20");

      view.dispatch({ selection: { anchor: view.state.doc.length } });
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull());
      expect(view.state.doc.toString()).toBe(changed);
      expect(parent.textContent).not.toContain("| --- | --- | --- |");
    } finally { view.destroy(); }
  });

  it("fails closed when an external source edit breaks merge topology", async () => {
    const source = [
      "Before",
      "",
      "| A | B |",
      "| --- | --- |",
      "| X | 1 |",
      "| ^ | 2 |",
      "",
      "End",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: source.indexOf("X") });
    try {
      view.focus();
      const from = source.indexOf("| X | 1 |");
      const to = source.indexOf("\n\nEnd");
      const replacement = "| ^ | 2 |\n| X | 1 |";
      view.dispatch({ changes: { from, to, insert: replacement } });
      const changed = view.state.doc.toString();
      const parsed = parseEditableTables(changed).tables[0]!;
      expect(parsed.valid).toBe(false);
      expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === "merge-boundary")).toBe(true);

      view.dispatch({ selection: { anchor: view.state.doc.length } });
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-invalid")).not.toBeNull());
      expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
      expect(parent.textContent).toContain("| --- | --- |");
      expect(view.state.doc.toString()).toBe([
        "Before",
        "",
        "| A | B |",
        "| --- | --- |",
        "| ^ | 2 |",
        "| X | 1 |",
        "",
        "End",
      ].join("\n"));
    } finally { view.destroy(); }
  });

  it("edits and extends a headerless table without inventing column headers", async () => {
    const source = "Before\n\n| - | --: |\n| A | 1 |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      const host = parent.querySelector<HTMLElement>(".structural-tables-live-preview")!;
      expect(host).not.toBeNull();
      expect(host.querySelector("thead")).toBeNull();

      const first = host.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
      first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = first.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Changed";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(parseEditableTables(view.state.doc.toString()).tables[0]?.rows[0]?.cells[0]?.content).toBe("Changed"));
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='1'][data-structural-column='0'] textarea"))
        .not.toBeNull());
      expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows).toHaveLength(2);

      parent.querySelector<HTMLButtonElement>(".structural-tables-add-row")!.click();
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='2'][data-structural-column='0'] textarea")).not.toBeNull());
      let parsed = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(parsed.headerRowCount).toBe(0);
      expect(parsed.rows).toHaveLength(3);
      parent.querySelector<HTMLTextAreaElement>("textarea")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );

      parent.querySelector<HTMLButtonElement>(".structural-tables-add-column")!.click();
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='0'][data-structural-column='2'] textarea")).not.toBeNull());
      parsed = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(parsed.headerRowCount).toBe(0);
      expect(parsed.columnCount).toBe(3);
      expect(parent.querySelector("thead")).toBeNull();

      parent.querySelector<HTMLTextAreaElement>("textarea")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      expect(undo(view)).toBe(true);
      expect(parseEditableTables(view.state.doc.toString()).tables[0]?.headerRowCount).toBe(0);
    } finally {
      view.destroy();
    }
  });

  it.each(["row", "column"] as const)("keeps Callout add-%s activation local and opens the new cell after a rebuild", async (axis) => {
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div"); element.className = options.cls; return element;
    });
    const nativeTable = (source: string): HTMLElement => {
      const table = document.createElement("table");
      const parsed = parseEditableTables(source).tables[0]!;
      parsed.rows.forEach((row, index) => {
        const section = table.querySelector(index < parsed.headerRowCount ? "thead" : "tbody")
          ?? table.appendChild(document.createElement(index < parsed.headerRowCount ? "thead" : "tbody"));
        const tr = section.appendChild(document.createElement("tr"));
        row.cells.forEach((cell) => {
          tr.appendChild(document.createElement(index < parsed.headerRowCount ? "th" : "td")).textContent = cell.content;
        });
      });
      return table;
    };
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const container = args[2] as HTMLElement;
      if (container.className === "structural-tables-container") container.replaceChildren(nativeTable(args[1] as string));
    });
    class GrowingCallout extends NativeCalloutWidget {
      constructor(private readonly source: string) { super(); }
      override toDOM(): HTMLElement {
        const element = super.toDOM();
        element.querySelector(".callout-content")!.replaceChildren(nativeTable(this.source));
        return element;
      }
    }
    const nativeFor = (source: string) => Decoration.set([
      Decoration.replace({ widget: new GrowingCallout(source), block: true })
        .range(source.indexOf("> [!note]"), source.indexOf("\n\nEnd")),
    ]);
    const native = StateField.define({
      create: (state) => nativeFor(state.doc.toString()),
      update: (value, transaction) => transaction.docChanged ? nativeFor(transaction.newDoc.toString()) : value,
      provide: (field) => EditorView.decorations.from(field),
    });
    const source = "Before\n\n> [!note]\n> | A | < |\n> | --- | --- |\n> | x | y |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [native, history()]);
    try {
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
      const activateNativeSource = vi.fn(() => view.dispatch({ selection: { anchor: source.indexOf("> | A") } }));
      parent.querySelector(".callout")!.addEventListener("click", activateNativeSource);
      parent.querySelector<HTMLButtonElement>(`.structural-tables-add-${axis}`)!.click();
      expect(activateNativeSource).not.toHaveBeenCalled();
      const coordinate = axis === "row" ? "[data-structural-row='2'][data-structural-column='0']"
        : "[data-structural-row='0'][data-structural-column='2']";
      await vi.waitFor(() => expect(parent.querySelector(`.callout ${coordinate} textarea`)).not.toBeNull());
      expect(document.activeElement).toBe(parent.querySelector(`.callout ${coordinate} textarea`));
      expect(view.state.doc.toString().split("\n").filter((line) => line.includes("|")).every((line) => line.startsWith("> "))).toBe(true);
      parent.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("isolates whole-table removal history from adjacent prose edits and maps through unrecorded prefixes", async () => {
    const tableText = "| H | V |\n| --- || --- |\n| A | 1 |";
    const original = `Lead\n\n${tableText}\n\nTail`;
    const { parent, view } = mountEditor(original, { anchor: original.length }, [history()]);
    try {
      view.dispatch({ changes: { from: 0, insert: "Typed " } });
      view.dispatch({
        changes: { from: 0, insert: "Prefix\n" },
        annotations: Transaction.addToHistory.of(false),
      });
      const current = view.state.doc.toString();
      const table = parseEditableTables(current).tables[0]!;
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu?.items.find((item) => item.title === "Delete table")?.callback?.();
      await Promise.resolve();

      expect(view.state.doc.toString()).toBe(current.slice(0, table.range.from) + current.slice(table.range.to));
      expect(undo(view)).toBe(true);
      await Promise.resolve();
      expect(view.state.doc.toString()).toBe(current);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(`Prefix\n${original}`);
    } finally {
      view.destroy();
    }
  });

  it("refreshes appearance without changing source or merge semantics", () => {
    const { parent, view, updateSettings } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const before = view.state.doc.toString();
    const spans = () => [...parent.querySelectorAll("td, th")].map((cell) => [cell.getAttribute("rowspan"), cell.getAttribute("colspan")]);
    const expectedSpans = spans();
    for (const appearance of ["grid", "three-line", "theme"] as const) {
      updateSettings({ appearance });
      expect(parent.querySelector<HTMLElement>(".structural-tables-live-preview")?.dataset.appearance).toBe(appearance);
      expect(spans()).toEqual(expectedSpans);
      expect(view.state.doc.toString()).toBe(before);
    }
    view.destroy();
  });

  it("rebuilds from current source after rendering is disabled and re-enabled", () => {
    const source = `Introduction\n\n${screenshotTable}`;
    const { parent, view, updateSettings } = mountEditor(source, { anchor: 0 });
    updateSettings({ enableLivePreview: false });
    expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
    view.dispatch({ changes: { from: 0, insert: "Another paragraph\n\n" } });
    updateSettings({ enableLivePreview: true });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
    editor.value = "Current source";
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.state.doc.toString()).toContain("Current source");
    view.destroy();
  });

  it("matches Mod to one configured platform modifier instead of either modifier", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select();
      setMockModKey("meta");
      const ctrl = new KeyboardEvent("keydown", {
        key: "b", ctrlKey: true, bubbles: true, cancelable: true,
      });
      expect(dispatchScopeCaptureThenDom(editor, ctrl)).toBe(false);
      expect(ctrl.defaultPrevented).toBe(false);
      expect(editor.value).toBe("West");

      const meta = dispatchDraftShortcut(editor, "b", "meta");
      expect(meta.defaultPrevented).toBe(true);
      expect(editor.value).toBe("**West**");
    } finally {
      view.destroy();
    }
  });

  it.each([
    {
      name: "italic inside bold",
      value: "**West**", start: 2, end: 6, key: "i", expected: "***West***", selection: [3, 7],
    },
    {
      name: "italic over whole bold value",
      value: "**West**", start: 0, end: 8, key: "i", expected: "***West***", selection: [3, 7],
    },
    {
      name: "bold off inside bold+italic",
      value: "***West***", start: 3, end: 7, key: "b", expected: "*West*", selection: [1, 5],
    },
    {
      name: "italic off inside bold+italic",
      value: "***West***", start: 3, end: 7, key: "i", expected: "**West**", selection: [2, 6],
    },
    {
      name: "partial selection",
      value: "West coast", start: 0, end: 4, key: "i", expected: "*West* coast", selection: [1, 5],
    },
    {
      name: "literal star inside selection",
      value: "4 * 5 = 20", start: 0, end: 10, key: "b", expected: "**4 * 5 = 20**", selection: [2, 12],
    },
    {
      name: "inner bold wrapper selected inside bold+italic",
      value: "***West***", start: 1, end: 9, key: "b", expected: "*West*", selection: [1, 5],
    },
  ] as const)("preserves other Markdown emphasis while toggling $name", ({ value, start, end, key, expected, selection }) => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = value;
      editor.setSelectionRange(start, end);

      dispatchDraftShortcut(editor, key);

      expect(editor.value).toBe(expected);
      expect([editor.selectionStart, editor.selectionEnd]).toEqual(selection);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it.each([
    {
      name: "intraword italic marker selection",
      value: "a*!*b", start: 1, end: 4, key: "i",
    },
    {
      name: "intraword italic content-only selection",
      value: "a*!*b", start: 2, end: 3, key: "i",
    },
    {
      name: "intraword bold marker selection",
      value: "a**!**b", start: 1, end: 6, key: "b",
    },
    {
      name: "intraword bold content-only selection",
      value: "a**!**b", start: 3, end: 4, key: "b",
    },
    {
      name: "intraword Unicode punctuation marker selection",
      value: "中*！*文", start: 1, end: 4, key: "i",
    },
    {
      name: "intraword Unicode punctuation content-only selection",
      value: "中*！*文", start: 2, end: 3, key: "i",
    },
    {
      name: "intraword plus symbol marker selection",
      value: "a*+*b", start: 1, end: 4, key: "i",
    },
    {
      name: "intraword plus symbol content-only selection",
      value: "a*+*b", start: 2, end: 3, key: "i",
    },
    {
      name: "intraword dollar symbol marker selection",
      value: "a*$*b", start: 1, end: 4, key: "i",
    },
    {
      name: "intraword dollar symbol content-only selection",
      value: "a*$*b", start: 2, end: 3, key: "i",
    },
    {
      name: "intraword Unicode symbol marker selection",
      value: "a*©*b", start: 1, end: 4, key: "i",
    },
    {
      name: "intraword Unicode symbol content-only selection",
      value: "a*©*b", start: 2, end: 3, key: "i",
    },
  ] as const)("keeps non-flanking literal stars for $name", ({ value, start, end, key }) => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = value;
      editor.setSelectionRange(start, end);

      dispatchDraftShortcut(editor, key);

      expect(editor.value).toBe(value);
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([start, end]);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it.each([
    {
      name: "standalone italic punctuation wrapper",
      value: "*!*", start: 0, end: 3, key: "i", expected: "!",
    },
    {
      name: "standalone italic punctuation content",
      value: "*!*", start: 1, end: 2, key: "i", expected: "!",
    },
    {
      name: "standalone bold punctuation wrapper",
      value: "**!**", start: 0, end: 5, key: "b", expected: "!",
    },
    {
      name: "standalone bold punctuation content",
      value: "**!**", start: 2, end: 3, key: "b", expected: "!",
    },
    {
      name: "standalone Unicode punctuation wrapper",
      value: "*！*", start: 0, end: 3, key: "i", expected: "！",
    },
    {
      name: "standalone Unicode punctuation content",
      value: "*！*", start: 1, end: 2, key: "i", expected: "！",
    },
    {
      name: "standalone plus symbol wrapper",
      value: "*+*", start: 0, end: 3, key: "i", expected: "+",
    },
    {
      name: "standalone plus symbol content",
      value: "*+*", start: 1, end: 2, key: "i", expected: "+",
    },
    {
      name: "standalone dollar symbol wrapper",
      value: "*$*", start: 0, end: 3, key: "i", expected: "$",
    },
    {
      name: "standalone dollar symbol content",
      value: "*$*", start: 1, end: 2, key: "i", expected: "$",
    },
    {
      name: "standalone Unicode symbol wrapper",
      value: "*©*", start: 0, end: 3, key: "i", expected: "©",
    },
    {
      name: "standalone Unicode symbol content",
      value: "*©*", start: 1, end: 2, key: "i", expected: "©",
    },
  ] as const)("recognizes flanking punctuation emphasis for $name", ({ value, start, end, key, expected }) => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = value;
      editor.setSelectionRange(start, end);

      dispatchDraftShortcut(editor, key);

      expect(editor.value).toBe(expected);
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, expected.length]);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("toggles the same format repeatedly without removing the other format", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select();

      dispatchDraftShortcut(editor, "b");
      expect(editor.value).toBe("**West**");
      dispatchDraftShortcut(editor, "b");
      expect(editor.value).toBe("West");
      dispatchDraftShortcut(editor, "i");
      expect(editor.value).toBe("*West*");
      dispatchDraftShortcut(editor, "b");
      expect(editor.value).toBe("***West***");
      dispatchDraftShortcut(editor, "b");
      expect(editor.value).toBe("*West*");
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it.each([
    {
      name: "whitespace-delimited whole selection",
      value: "* West *", start: 0, end: 8, key: "i",
    },
    {
      name: "whitespace-delimited embedded selection",
      value: "literal * West * end", start: 8, end: 16, key: "i",
    },
    {
      name: "partial combined run",
      value: "***West***", start: 0, end: 9, key: "b",
    },
    {
      name: "escaped complete wrapper",
      value: String.raw`\*West\*`, start: 1, end: 8, key: "i",
    },
  ] as const)("keeps ambiguous or invalid star delimiters literal for $name", ({ value, start, end, key }) => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = value;
      editor.setSelectionRange(start, end);

      dispatchDraftShortcut(editor, key);

      expect(editor.value).toBe(value);
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([start, end]);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("does not interpret escaped stars as an existing emphasis wrapper", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = String.raw`\*West\*`;
      editor.setSelectionRange(2, 6);

      dispatchDraftShortcut(editor, "b");

      expect(editor.value.slice(0, 2)).toBe(String.raw`\*`);
      expect(editor.value.slice(-2)).toBe(String.raw`\*`);
      expect(editor.value.slice(2, -2)).toBe("**West**");
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it.each([false, true])("navigates every visible anchor once through row spans (backward=%s)", async (backward) => {
    const source = "Intro\n\n| H1 | H2 |\n| --- | --- |\n| A | B |\n| ^ | C |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const coordinate = backward ? [2, 1] : [0, 0];
      parent.querySelector<HTMLElement>(`[data-structural-row='${coordinate[0]}'][data-structural-column='${coordinate[1]}']`)!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const visited: string[] = [];
      for (let step = 0; step < 5; step += 1) {
        const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
        visited.push(editor.value);
        editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: backward, bubbles: true }));
        await Promise.resolve();
      }
      expect(visited).toEqual(backward ? ["C", "B", "A", "H2", "H1"] : ["H1", "H2", "A", "B", "C"]);
      if (backward) {
        expect(parent.querySelector("textarea")).toBeNull();
        expect(view.state.doc.toString()).toBe(source);
      } else {
        expect(parent.querySelector("[data-structural-row='3'][data-structural-column='0'] textarea")).not.toBeNull();
        expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows).toHaveLength(4);
      }
    } finally { view.destroy(); }
  });

  it("maps unique Markdown emphasis to its original source caret", () => {
    const source = "| H | V |\n| --- || --- |\n| **North** | Keep |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      const content = cell.querySelector<HTMLElement>(".structural-tables-cell-content")!;
      content.innerHTML = "<strong>North</strong>";
      const text = content.querySelector("strong")!.firstChild!;
      Object.defineProperty(document, "caretPositionFromPoint", {
        configurable: true,
        value: () => ({ offsetNode: text, offset: 2 }),
      });

      dispatchPointerDown(cell, "mouse");
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(editor.value).toBe("**North**");
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([4, 4]);
    } finally {
      Reflect.deleteProperty(document, "caretPositionFromPoint");
      view.destroy();
    }
  });

  it("extends and shrinks logical Shift+Arrow ranges without replacing the original head with merge bounds", () => {
    const source = "| H1 | H2 | H3 |\n| --- || --- | --- |\n| A | B | C |\n| D | E | F |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = (row: number, column: number) => parent.querySelector<HTMLElement>(
        `[data-structural-row='${row}'][data-structural-column='${column}']`,
      )!;
      dispatchPointerDown(cell(1, 0), "mouse");
      const active = cell(1, 0);
      active.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true }));
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(2);
      cell(1, 1).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true, cancelable: true }));
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
      cell(2, 1).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true, cancelable: true }));
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(2);
    } finally { view.destroy(); }
  });

  it("expands through a merged owner and shrinks back from the logical Shift+Arrow head", () => {
    const source = "| A | < | C |\n| --- | --- | --- |\n| D | E | F |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const right = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='2']")!;
      dispatchPointerDown(right, "mouse");
      right.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true, cancelable: true }));
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(2);
      const merged = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
      merged.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true }));
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(1);

      const table = parent.querySelector<HTMLTableElement>(".structural-tables-table")!;
      table.style.direction = "rtl";
      dispatchPointerDown(merged, "mouse");
      merged.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true, cancelable: true }));
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(2);
    } finally { view.destroy(); }
  });

  it("returns to the original covered column after a vertical Shift round trip through a horizontal merge", () => {
    const source = "| A | < | C |\n| --- | --- | --- |\n| D | E | F |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const e = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      dispatchPointerDown(e, "mouse");
      e.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true, cancelable: true }));
      const merged = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
      expect(document.activeElement).toBe(merged);
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(3);
      merged.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(e);
      expect([...parent.querySelectorAll("[aria-selected='true']")]).toEqual([e]);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("returns to the original covered row after a horizontal Shift round trip through a vertical merge", () => {
    const source = "| H | V |\n| --- | --- |\n| A | one |\n| ^ | two |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const two = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
      dispatchPointerDown(two, "mouse");
      two.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true, cancelable: true }));
      const merged = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      expect(document.activeElement).toBe(merged);
      merged.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(two);
      expect([...parent.querySelectorAll("[aria-selected='true']")]).toEqual([two]);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("provides block replacements through editor state so opening a Markdown view succeeds", () => {
    const source = [
      "Introduction",
      "",
      "| Region | Sales | < |",
      "| Quarter | Q1 | Q2 |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: 0 });
    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();

    view.destroy();
  });

  it("wins an exact-range replacement conflict with an earlier high-priority native decoration", () => {
    const prefix = "Before\n\n";
    const source = `${prefix}${screenshotTable}`;
    const nativeTableField = StateField.define({
      create: () => Decoration.set([
        Decoration.replace({ widget: new NativeTableWidget(), block: true })
          .range(prefix.length, source.length),
      ]),
      update: (value) => value,
      provide: (field) => Prec.high(EditorView.decorations.from(field)),
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [nativeTableField]);

    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
    expect(parent.querySelector(".test-native-table")).toBeNull();

    view.destroy();
  });

  it.each(["<", "^"])("keeps hidden %s markers native by default and refuses lossy editing after opt-in", async (marker) => {
    const source = `| Name | Status |\n| --- | --- |\n| Alice | Doing | ${marker} |`;
    const mounted = mountEditor(source, { anchor: source.length });
    try {
      expect(mounted.parent.querySelector(".structural-tables-live-preview")).toBeNull();
      mounted.updateSettings({ takeOverOrdinaryTables: true });
      const host = mounted.parent.querySelector<HTMLElement>(".structural-tables-live-preview")!;
      expect(host.dataset.tableKind).toBe("ordinary");
      const cell = host.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Keep this draft";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      await Promise.resolve();
      expect(mounted.view.state.doc.toString()).toBe(source);
      expect(mounted.parent.querySelector("textarea")).toBe(editor);
      expect(editor.value).toBe("Keep this draft");
      mounted.updateSettings({ takeOverOrdinaryTables: false });
      expect(mounted.parent.querySelector(".structural-tables-live-preview")).toBeNull();
      expect(mounted.view.state.doc.toString()).toBe(source);
    } finally {
      mounted.view.destroy();
    }
  });

  it("takes over ordinary GFM tables only while the opt-in setting is enabled", () => {
    const source = "| Name | Status |\n| --- | --- |\n| Alice | Doing |";
    const disabled = mountEditor(source, { anchor: source.length });
    expect(disabled.parent.querySelector(".structural-tables-live-preview")).toBeNull();
    disabled.view.destroy();

    const requested: StructuralTable[] = [];
    const enabled = mountEditor(
      source,
      { anchor: source.length },
      [],
      (_editor, _sourceFile, table) => { requested.push(table); },
      { takeOverOrdinaryTables: true },
    );
    const host = enabled.parent.querySelector<HTMLElement>(".structural-tables-live-preview");
    expect(host?.dataset.tableKind).toBe("ordinary");
    const cell = host?.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']");
    cell?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(lastMenu?.items.map((item) => item.title)).toContain("Upgrade to Base…");
    expect(lastMenu?.items.map((item) => item.title)).toContain("Insert row above");
    lastMenu?.items.find((item) => item.title === "Upgrade to Base…")?.callback?.();
    expect(requested[0]?.structural).toBe(false);

    enabled.updateSettings({ takeOverOrdinaryTables: false });
    expect(enabled.parent.querySelector(".structural-tables-live-preview")).toBeNull();
    expect(enabled.view.state.doc.toString()).toBe(source);
    enabled.view.destroy();
  });

  it.each([0, 16].flatMap((scrollbarHeight) => ["ltr", "rtl"].map((direction) => ({ scrollbarHeight, direction }))))(
    "keeps the add-row hit region below a $scrollbarHeight-pixel scrollbar in $direction tables",
    ({ scrollbarHeight, direction }) => {
      const originalRect = HTMLElement.prototype.getBoundingClientRect;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("structural-tables-live-preview")) return new DOMRect(20, 10, 500, 300);
        if (this.classList.contains("structural-tables-table")) return new DOMRect(-120, 50, 900, 200);
        if (this.classList.contains("structural-tables-container")) return new DOMRect(70, 50, 250, 200 + scrollbarHeight);
        return originalRect.call(this);
      });
      const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
      const table = parent.querySelector<HTMLElement>(".structural-tables-table")!;
      const scroller = parent.querySelector<HTMLElement>(".structural-tables-container")!;
      table.style.direction = direction;
      scroller.dispatchEvent(new Event("scroll"));
      const host = parent.querySelector<HTMLElement>(".structural-tables-live-preview")!;
      const addRow = parent.querySelector<HTMLElement>(".structural-tables-add-row")!;
      const buttonTop = host.getBoundingClientRect().top + Number.parseFloat(addRow.style.top);
      expect(buttonTop).toBe(scroller.getBoundingClientRect().bottom);
      expect(Number.parseFloat(addRow.style.left)).toBe(50);
      expect(Number.parseFloat(addRow.style.width)).toBe(250);
      expect(view.state.doc.toString()).toBe(screenshotTable);
      view.destroy();
    },
  );

  it.each(["Escape", "Enter"])("preserves rendered sizing content and restores the same nodes after %s", (key) => {
    const source = "| Name | Value |\n| --- || --- |\n| Long | abcdefghijklmnopqrstuvwxyz |\n| Next | Short |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
    const content = cell.querySelector<HTMLElement>(".structural-tables-cell-content")!;
    const text = content.appendChild(document.createTextNode("abcdefghijklmnopqrstuvwxyz"));
    const link = content.appendChild(document.createElement("a"));
    link.textContent = "Rendered link";
    const activated = vi.fn();
    link.addEventListener("click", activated);
    const originalNodes = [...cell.childNodes];

    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(text.isConnected).toBe(true);
    expect(link.parentNode).toBe(content);
    expect(cell.classList.contains("is-editing")).toBe(true);
    expect(view.state.doc.toString()).toBe(source);

    editor.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect([...cell.childNodes]).toEqual(originalNodes);
    expect(cell.classList.contains("is-editing")).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
    link.click();
    expect(activated).toHaveBeenCalledOnce();
    view.destroy();
  });
});

it("third-party DOM mutation keeps a detached ordinary-table widget stable", async () => {
  const source = "Before\n\n| Name | Value |\n| --- | --- |\n| Target | 10 |\n\nEnd";
  const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, markdown, target) => {
    const link = target.ownerDocument.createElement("a");
    link.className = "review-virtual-link";
    link.textContent = markdown;
    target.replaceChildren(link);
  });
  const { parent, view } = mountEditor(source, { anchor: 0 }, [], undefined, { takeOverOrdinaryTables: true });
  try {
    parent.remove();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const host = parent.querySelector(".structural-tables-live-preview");
    expect(host).not.toBeNull();
    expect(parent.querySelectorAll(".review-virtual-link")).toHaveLength(4);
    expect(render).toHaveBeenCalledTimes(4);
    document.body.appendChild(parent);
    for (let index = 0; index < 5; index += 1) {
      const link = parent.querySelector(".review-virtual-link")!;
      link.appendChild(document.createTextNode(" "));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(parent.querySelector(".structural-tables-live-preview")).toBe(host);
    }
    parent.remove();
    await new Promise((resolve) => setTimeout(resolve, 10));
    document.body.appendChild(parent);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(parent.querySelector(".structural-tables-live-preview")).toBe(host);
    expect(render).toHaveBeenCalledTimes(4);
    expect(view.state.doc.toString()).toBe(source);
  } finally { view.destroy(); }
});
