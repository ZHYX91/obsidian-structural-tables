// @vitest-environment happy-dom

import type { App, Editor } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StructuralTablesPlugin } from "../src/app/plugin";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { notices } from "./mocks/obsidian";

type PasteHandler = (event: ClipboardEvent, editor: Editor) => void;

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

beforeEach(() => {
  notices.splice(0);
});

describe("registered whole-note HTML paste entry", () => {
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

    handler(event, { replaceSelection } as unknown as Editor);

    expect(replaceSelection).toHaveBeenCalledOnce();
    expect(replaceSelection).toHaveBeenCalledWith(plain);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(notices).toEqual([
      "Pasted the complete plain-text alternative. Rich formatting and attachments may need to be added separately.",
    ]);
    expect(notices).not.toContain("HTML table pasted with structural spans preserved.");
  });

  it("blocks an empty HTML table with no plain fallback and preserves the selection", () => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(
      "<table><tr><td></td><td></td></tr></table>",
      "",
    );

    handler(event, { replaceSelection } as unknown as Editor);

    expect(replaceSelection).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(notices).toEqual([
      "The HTML table was empty and no plain-text alternative was available. The current selection was kept.",
    ]);
  });

  it.each([
    ["both formats empty", "", ""],
    ["preformatted content", "<table><tr><td><pre>A\nB</pre></td><td>2</td></tr></table>", "A\nB\t2"],
    ["superscript content", "<table><tr><td>x<sup>2</sup></td><td>2</td></tr></table>", "x²\t2"],
    ["unsupported image", '<table><tr><td><img src="x.png"></td><td>2</td></tr></table>', "image\t2"],
    ["mixed prose", "<p>Before</p><table><tr><td></td><td></td></tr></table>", "fallback"],
    ["multiple tables", "<table><tr><td></td><td></td></tr></table><table><tr><td></td><td></td></tr></table>", "fallback"],
  ])("leaves %s entirely to native paste", (_name, html, plain) => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(html, plain);

    handler(event, { replaceSelection } as unknown as Editor);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(replaceSelection).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it("does nothing when HTML table conversion is disabled", () => {
    const handler = registeredPasteHandler({ convertHtmlTablePaste: false });
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(
      "<table><tr><td></td><td></td></tr></table>",
      "IMPORTANT-PLAIN",
    );

    handler(event, { replaceSelection } as unknown as Editor);

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

    handler(event, { replaceSelection } as unknown as Editor);

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

    handler(event, { replaceSelection } as unknown as Editor);

    expect(replaceSelection).toHaveBeenCalledOnce();
    expect(replaceSelection.mock.calls[0]?.[0]).toContain("| A");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(notices).toContain("HTML table pasted with structural spans preserved.");
  });
});
