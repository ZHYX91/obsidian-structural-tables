// @vitest-environment happy-dom

import type { App, Editor } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StructuralTablesPlugin } from "../src/app/plugin";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { notices } from "./mocks/obsidian";
import { parseEditableTables } from "../src/core/parser";
import { structuralTableToDelimited } from "../src/core/interchange";
import { tableCommandEditor } from "./helpers/table-command-editor";
import { undo, redo } from "@codemirror/commands";
import MarkdownIt from "markdown-it";

type PasteHandler = (event: ClipboardEvent, editor: Editor) => void;

function emptySelectionEditor(replaceSelection: (value: string) => void): Editor {
  return { replaceSelection, getValue: () => "", getCursor: () => ({ line: 0, ch: 0 }), posToOffset: () => 0,
    listSelections: () => [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }] } as unknown as Editor;
}

function registeredPasteHandler(
  settings: Partial<typeof DEFAULT_SETTINGS> = {},
): PasteHandler {
  let handler: PasteHandler | undefined;
  const app = {
    workspace: {
      on: (name: string, callback: PasteHandler) => {
        if (name === "editor-paste") handler = callback;
        return {};
      },
    },
  } as unknown as App;
  const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
    app,
    settings: { ...DEFAULT_SETTINGS, convertHtmlTablePaste: true, language: "en", ...settings },
  }) as unknown as { registerHtmlTablePaste: () => void };
  plugin.registerHtmlTablePaste();
  if (handler === undefined) throw new Error("Expected editor-paste registration.");
  return handler;
}

function clipboardEvent(html: string, plain: string, defaultPrevented = false) {
  const preventDefault = vi.fn();
  return {
    event: {
      defaultPrevented,
      clipboardData: {
        getData: (type: string) => type === "text/html" ? html : plain,
      },
      preventDefault,
    } as unknown as ClipboardEvent,
    preventDefault,
  };
}

function realDataTransferEvent(
  html: string,
  plain: string,
  configure?: (data: DataTransfer) => void,
) {
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/html", html);
  clipboardData.setData("text/plain", plain);
  configure?.(clipboardData);
  const preventDefault = vi.fn();
  return {
    event: {
      defaultPrevented: false,
      clipboardData,
      preventDefault,
    } as unknown as ClipboardEvent,
    clipboardData,
    preventDefault,
  };
}

beforeEach(() => {
  notices.splice(0);
});

describe("registered whole-note HTML paste entry", () => {
  it.each([false, true])("checks the complete selected document before table paste (blank=%s)", (blank) => {
    const marker = "PLACEHOLDER";
    const neighbor = "| Later prose | stays visible | IMPORTANT THIRD CELL |";
    const gap = blank ? "\n\n" : "\n";
    const source = `Before\n\n${marker}${gap}${neighbor}\n\nAfter`;
    const f = tableCommandEditor(source);
    try {
      const from = source.indexOf(marker);
      f.cm.dispatch({ selection: { anchor: from, head: from + marker.length } });
      const selection = f.cm.state.selection;
      Object.assign(f.editor, {
        listSelections: () => [{ anchor: f.editor.offsetToPos(f.cm.state.selection.main.anchor), head: f.editor.offsetToPos(f.cm.state.selection.main.head) }],
        getCursor: (which?: "from" | "to") => f.editor.offsetToPos(which === "from"
          ? f.cm.state.selection.main.from : f.cm.state.selection.main.to),
        replaceSelection: (insert: string) => f.cm.dispatch(f.cm.state.replaceSelection(insert)),
      });
      const { event, preventDefault } = clipboardEvent(
        "<table><tr><th>Name</th><th>Value</th></tr><tr><td>Alpha</td><td>Beta</td></tr></table>", "Name\tValue\nAlpha\tBeta",
      );
      registeredPasteHandler()(event, f.editor);
      expect(preventDefault).toHaveBeenCalledOnce();
      if (!blank) {
        expect(f.source()).toBe(source);
        expect(f.cm.state.selection.eq(selection)).toBe(true);
        expect(f.writes()).toBe(0);
        expect(undo(f.cm)).toBe(false);
        expect(notices).toEqual(["Cannot safely finish this action: the table or its boundaries would become invalid. Your note was not changed."]);
      } else {
        const result = f.source();
        const table = parseEditableTables(result).tables[0]!;
        expect(table.range.from).toBe(from);
        expect(result.slice(table.range.to)).toBe(`${gap}${neighbor}\n\nAfter`);
        expect(structuralTableToDelimited(table, "\t")).toBe("Name\tValue\nAlpha\tBeta");
        const dom = new DOMParser().parseFromString(new MarkdownIt().render(result), "text/html");
        expect(dom.querySelectorAll("tbody tr")).toHaveLength(1);
        expect([...dom.querySelectorAll("p")].some((p) => p.textContent === neighbor)).toBe(true);
        expect(f.writes()).toBe(1);
        expect(undo(f.cm)).toBe(true);
        expect(f.source()).toBe(source);
        expect(redo(f.cm)).toBe(true);
        expect(f.source()).toBe(result);
      }
    } finally { f.destroy(); }
  });

  it("blocks a literal plain fallback that would absorb unselected pipe prose", () => {
    let source = "PLACEHOLDER\n| Later | prose | KEEP-HIDDEN |";
    const before = source;
    const replaceSelection = vi.fn((insert: string) => { source = insert + source.slice(11); });
    const editor = { getValue: () => source, getCursor: (which: string) => ({ line: 0, ch: which === "from" ? 0 : 11 }),
      posToOffset: (position: { ch: number }) => position.ch, replaceSelection,
      listSelections: () => [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 11 } }] } as unknown as Editor;
    const plain = "| A | B |\n| --- | --- |\n| x | y |";
    const { event, preventDefault } = clipboardEvent("<table><tr><td>x<sup>2</sup></td><td>2</td></tr></table>", plain);
    registeredPasteHandler()(event, editor);
    expect(source).toBe(before);
    expect(replaceSelection).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(notices[0]).toContain("boundaries");
  });

  it("refuses multiple source selections rather than validating only one target", () => {
    const replaceSelection = vi.fn();
    const editor = emptySelectionEditor(replaceSelection);
    Object.assign(editor, { listSelections: () => [{}, {}] });
    const { event, preventDefault } = clipboardEvent("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>", "A\tB\n1\t2");
    registeredPasteHandler()(event, editor);
    expect(replaceSelection).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it.each([
    ["IMPORTANT-PLAIN", "IMPORTANT-PLAIN"],
    ["multiline and surrounding whitespace", "  first line\nsecond line\n  "],
  ])("replaces an empty HTML table with the complete plain fallback: %s", (_name, plain) => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(
      "<table><tr><td></td><td></td></tr></table>",
      plain,
    );

    handler(event, emptySelectionEditor(replaceSelection));

    expect(replaceSelection).toHaveBeenCalledOnce();
    expect(replaceSelection).toHaveBeenCalledWith(plain);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(notices).toEqual([
      "Pasted the complete plain-text alternative. Rich formatting and attachments may need to be added separately.",
    ]);
    expect(notices).not.toContain("HTML table pasted with structural spans preserved.");
  });

  it.each([
    ["ordinary div wrapper", "<div><table><tr><td>x<sup>2</sup></td><td>2</td></tr></table></div>", "x²\t2"],
    ["ordinary span wrapper", "<span><table><tr><td>x<sup>2</sup></td><td>2</td></tr></table></span>", "x²\t2"],
    ["superscript", "<table><tr><td>x<sup>2</sup></td><td>2</td></tr></table>", "x²\t2"],
    ["subscript", "<table><tr><td>H<sub>2</sub>O</td><td>water</td></tr></table>", "H₂O\twater"],
    ["negative exponent", "<table><tr><td>x<sup>-2</sup></td><td>2</td></tr></table>", "x⁻²\t2"],
    ["nested superscript", "<table><tr><td>x<sup><span>2</span></sup></td><td>2</td></tr></table>", "x²\t2"],
    ["preformatted whitespace", "<table><tr><td><pre>A\n  B\tC</pre></td><td>2</td></tr></table>", "A\n  B\tC\t2"],
  ])("uses the complete plain fallback for %s without flattening HTML semantics", (_name, html, plain) => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(html, plain);

    handler(event, emptySelectionEditor(replaceSelection));

    expect(replaceSelection).toHaveBeenCalledOnce();
    expect(replaceSelection).toHaveBeenCalledWith(plain);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(notices).toEqual([
      "Pasted the complete plain-text alternative. Rich formatting and attachments may need to be added separately.",
    ]);
    expect(notices).not.toContain("HTML table pasted with structural spans preserved.");
  });

  it.each([
    ["preserved whitespace", '<table><tr><td style="white-space: pre-wrap">A\n  B\tC</td><td>2</td></tr></table>', "A\n  B\tC\t2"],
    ["inherited whitespace", '<div style="white-space: pre-wrap"><table><tr><td>A\n  B\tC</td><td>2</td></tr></table></div>', "A\n  B\tC\t2"],
    ["preserved newlines", '<table><tr><td style="white-space: pre-line">A\nB</td><td>2</td></tr></table>', "A\nB\t2"],
    ["heading boundaries", "<table><tr><td><h3>First</h3><h3>Second</h3></td><td>2</td></tr></table>", "First\nSecond\t2"],
  ])("uses the complete plain fallback for %s instead of flattening text semantics", (_name, html, plain) => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(html, plain);

    handler(event, emptySelectionEditor(replaceSelection));

    expect(replaceSelection).toHaveBeenCalledOnce();
    expect(replaceSelection).toHaveBeenCalledWith(plain);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(notices).toEqual([
      "Pasted the complete plain-text alternative. Rich formatting and attachments may need to be added separately.",
    ]);
  });

  it.each([
    ["superscript", "<table><tr><td>x<sup>2</sup></td><td>2</td></tr></table>"],
    ["subscript", "<table><tr><td>H<sub>2</sub>O</td><td>water</td></tr></table>"],
    ["preformatted text", "<table><tr><td><pre>A\n  B</pre></td><td>2</td></tr></table>"],
    ["inherited whitespace", '<div style="white-space: pre-wrap"><table><tr><td>A\n  B\tC</td><td>2</td></tr></table></div>'],
    ["preserved newlines", '<table><tr><td style="white-space: pre-line">A\nB</td><td>2</td></tr></table>'],
  ])("blocks %s without plain text and preserves the selection", (_name, html) => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(html, "");

    handler(event, emptySelectionEditor(replaceSelection));

    expect(replaceSelection).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(notices).toEqual([
      "This HTML table contains text formatting that cannot be preserved safely, and no plain-text alternative was available. The current selection was kept.",
    ]);
  });

  it("blocks an empty HTML table with no plain fallback and preserves the selection", () => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(
      "<table><tr><td></td><td></td></tr></table>",
      "",
    );

    handler(event, emptySelectionEditor(replaceSelection));

    expect(replaceSelection).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(notices).toEqual([
      "The HTML table was empty and no plain-text alternative was available. The current selection was kept.",
    ]);
  });

  it.each([
    ["both formats empty", "", ""],
    ["unsupported image", '<table><tr><td><img src="x.png"></td><td>2</td></tr></table>', "image\t2"],
    ["mixed prose around superscript", "<p>Before</p><table><tr><td>x<sup>2</sup></td><td>2</td></tr></table>", "fallback"],
    ["multiple tables with superscript", "<table><tr><td>x<sup>2</sup></td><td>2</td></tr></table><table><tr><td>A</td><td>B</td></tr></table>", "fallback"],
    ["superscript plus image", '<table><tr><td>x<sup>2</sup><img src="x.png"></td><td>2</td></tr></table>', "x²\t2"],
    ["superscript plus link", '<table><tr><td>x<sup>2</sup> <a href="https://example.com">source</a></td><td>2</td></tr></table>', "x² source\t2"],
    ["link around table with plain", '<a href="https://example.com/source"><table><tr><td>x<sup>2</sup></td><td>2</td></tr></table></a>', "x²\t2"],
    ["link around table without plain", '<a href="https://example.com/source"><table><tr><td>x<sup>2</sup></td><td>2</td></tr></table></a>', ""],
    ["embed around table with plain", '<div class="internal-embed" src="Source.md"><table><tr><td>x<sup>2</sup></td><td>2</td></tr></table></div>', "x²\t2"],
    ["embed around table without plain", '<div class="internal-embed" src="Source.md"><table><tr><td>x<sup>2</sup></td><td>2</td></tr></table></div>', ""],
    ["embed inside table with plain", '<table><tr><td>x<sup>2</sup><span class="internal-embed" src="figure.svg"></span></td><td>2</td></tr></table>', "x²\t2"],
    ["embed inside table without plain", '<table><tr><td>x<sup>2</sup><span class="internal-embed" src="figure.svg"></span></td><td>2</td></tr></table>', ""],
    ["HTML embed inside table with plain", '<table><tr><td>x<sup>2</sup><embed src="figure.svg" type="image/svg+xml"></td><td>2</td></tr></table>', "x²\t2"],
    ["HTML embed inside table without plain", '<table><tr><td>x<sup>2</sup><embed src="figure.svg" type="image/svg+xml"></td><td>2</td></tr></table>', ""],
    ["HTML embed outside table with plain", '<div><table><tr><td>x<sup>2</sup></td><td>2</td></tr><embed src="figure.svg" type="image/svg+xml"></div>', "x²\t2"],
    ["HTML embed outside table without plain", '<div><table><tr><td>x<sup>2</sup></td><td>2</td></tr><embed src="figure.svg" type="image/svg+xml"></div>', ""],
  ])("leaves %s entirely to native paste", (_name, html, plain) => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(html, plain);

    handler(event, emptySelectionEditor(replaceSelection));

    expect(preventDefault).not.toHaveBeenCalled();
    expect(replaceSelection).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it.each([
    ["superscript", "<table><tr><td>x<sup>2</sup></td><td>2</td></tr></table>", "x²\t2"],
    ["empty table", "<table><tr><td></td><td></td></tr></table>", "IMPORTANT-PLAIN"],
  ])("keeps %s native when the real DataTransfer also carries a File", (_name, html, plain) => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, clipboardData, preventDefault } = realDataTransferEvent(html, plain, (data) => {
      data.items.add(new File([new Uint8Array([137, 80, 78, 71])], "pixel.png", { type: "image/png" }));
    });

    expect(clipboardData.files.length).toBe(1);
    expect(Array.from(clipboardData.items).some((item) => item.kind === "file")).toBe(true);

    handler(event, emptySelectionEditor(replaceSelection));

    expect(replaceSelection).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it("keeps a non-text custom clipboard MIME native", () => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, clipboardData, preventDefault } = realDataTransferEvent(
      "<table><tr><td>x<sup>2</sup></td><td>2</td></tr></table>",
      "x²\t2",
      (data) => data.setData("application/x-obsidian-test", "opaque"),
    );

    expect(Array.from(clipboardData.types)).toContain("application/x-obsidian-test");
    handler(event, emptySelectionEditor(replaceSelection));

    expect(replaceSelection).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it("still allows plain fallback when the only extra clipboard MIME is text", () => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, clipboardData, preventDefault } = realDataTransferEvent(
      "<table><tr><td>x<sup>2</sup></td><td>2</td></tr></table>",
      "x²\t2",
      (data) => data.setData("text/uri-list", "https://example.com/source"),
    );

    expect(Array.from(clipboardData.types)).toContain("text/uri-list");
    handler(event, emptySelectionEditor(replaceSelection));

    expect(replaceSelection).toHaveBeenCalledOnce();
    expect(replaceSelection).toHaveBeenCalledWith("x²\t2");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(notices).toEqual([
      "Pasted the complete plain-text alternative. Rich formatting and attachments may need to be added separately.",
    ]);
  });

  it("does nothing when HTML table conversion is disabled", () => {
    const handler = registeredPasteHandler({ convertHtmlTablePaste: false });
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(
      "<table><tr><td></td><td></td></tr></table>",
      "IMPORTANT-PLAIN",
    );

    handler(event, emptySelectionEditor(replaceSelection));

    expect(preventDefault).not.toHaveBeenCalled();
    expect(replaceSelection).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it("does nothing after another handler already prevented the paste", () => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(
      "<table><tr><td></td><td></td></tr></table>",
      "IMPORTANT-PLAIN",
      true,
    );

    handler(event, emptySelectionEditor(replaceSelection));

    expect(preventDefault).not.toHaveBeenCalled();
    expect(replaceSelection).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it("takes ownership only after inserting one supported table", () => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(
      "<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>",
      "A\tB\n1\t2",
    );

    handler(event, emptySelectionEditor(replaceSelection));

    expect(replaceSelection).toHaveBeenCalledOnce();
    expect(replaceSelection.mock.calls[0]?.[0]).toContain("| A");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(notices).toContain("HTML table pasted with structural spans preserved.");
  });
});
