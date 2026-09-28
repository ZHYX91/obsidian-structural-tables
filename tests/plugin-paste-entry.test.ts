// @vitest-environment happy-dom

import type { App, Editor } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StructuralTablesPlugin } from "../src/app/plugin";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { notices } from "./mocks/obsidian";

type PasteHandler = (event: ClipboardEvent, editor: Editor) => void;

function registeredPasteHandler(): PasteHandler {
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
    settings: { ...DEFAULT_SETTINGS, convertHtmlTablePaste: true, language: "en" },
  }) as unknown as { registerHtmlTablePaste: () => void };
  plugin.registerHtmlTablePaste();
  if (handler === undefined) throw new Error("Expected editor-paste registration.");
  return handler;
}

function clipboardEvent(html: string, plain: string) {
  const preventDefault = vi.fn();
  return {
    event: {
      defaultPrevented: false,
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
    ["empty table with meaningful plain text", "<table><tr><td></td><td></td></tr></table>", "Name\tValue\nimportant\t42"],
    ["preformatted content", "<table><tr><td><pre>A\nB</pre></td><td>2</td></tr></table>", "A\nB\t2"],
    ["superscript content", "<table><tr><td>x<sup>2</sup></td><td>2</td></tr></table>", "x²\t2"],
    ["unsupported image", '<table><tr><td><img src="x.png"></td><td>2</td></tr></table>', "image\t2"],
  ])("leaves %s entirely to native paste", (_name, html, plain) => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(html, plain);

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
    expect(notices).toContain("HTML table imported with its supported spans preserved.");
  });
});
