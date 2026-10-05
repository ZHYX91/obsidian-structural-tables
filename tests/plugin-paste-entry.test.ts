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

    handler(event, { replaceSelection } as unknown as Editor);

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
    ["heading boundaries", "<table><tr><td><h3>First</h3><h3>Second</h3></td><td>2</td></tr></table>", "First\nSecond\t2"],
  ])("uses the complete plain fallback for %s instead of flattening text semantics", (_name, html, plain) => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(html, plain);

    handler(event, { replaceSelection } as unknown as Editor);

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
  ])("blocks %s without plain text and preserves the selection", (_name, html) => {
    const handler = registeredPasteHandler();
    const replaceSelection = vi.fn();
    const { event, preventDefault } = clipboardEvent(html, "");

    handler(event, { replaceSelection } as unknown as Editor);

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

    handler(event, { replaceSelection } as unknown as Editor);

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

    handler(event, { replaceSelection } as unknown as Editor);

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

    handler(event, { replaceSelection } as unknown as Editor);

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
    handler(event, { replaceSelection } as unknown as Editor);

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
    handler(event, { replaceSelection } as unknown as Editor);

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
