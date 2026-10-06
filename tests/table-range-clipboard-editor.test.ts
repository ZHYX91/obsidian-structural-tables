// @vitest-environment happy-dom
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readTableRangeFromDataTransfer,
  readTableRangeFromNavigator,
  tableRangeClipboardRepresentations,
  writeTableRangeToDataTransfer,
  writeTableRangeToNavigator,
} from "../src/editor/table-range-clipboard";
import {
  TABLE_RANGE_CLIPBOARD_MIME,
  TABLE_RANGE_CLIPBOARD_WEB_MIME,
  TABLE_RANGE_HTML_ATTRIBUTE,
  type TableRangeClipboardPayloadV1,
} from "../src/core/table-range-clipboard";

const payload: TableRangeClipboardPayloadV1 = {
  version: 1,
  rows: 2,
  columns: 2,
  owners: [["o0", "o1"], ["o2", "o3"]],
  rawByOwner: { o0: "**A**", o1: String.raw`[[N\|A]]`, o2: "", o3: "`x`" },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function htmlOnlyClipboard(html: string): Clipboard {
  return {
    read: vi.fn(async () => [{ types: ["text/html"], getType: vi.fn(async () => new Blob([html], { type: "text/html" })) }]),
  } as unknown as Clipboard;
}

function carrierHtml(source: string, tag: "table" | "div" = "table"): string {
  const element = document.createElement(tag);
  element.setAttribute(TABLE_RANGE_HTML_ATTRIBUTE, source);
  return element.outerHTML;
}

describe("owned range clipboard bridge", () => {
  it("writes structured, plain, and HTML payloads synchronously to DataTransfer", () => {
    const transfer = new DataTransfer();
    expect(writeTableRangeToDataTransfer(transfer, payload)).toBe(true);
    expect(readTableRangeFromDataTransfer(transfer)).toEqual(payload);
    const represented = tableRangeClipboardRepresentations(payload);
    expect(transfer.getData(TABLE_RANGE_CLIPBOARD_MIME)).toBe(represented.structured);
    expect(transfer.getData("text/plain")).toBe(represented.plain);
    expect(transfer.getData("text/html")).toBe(represented.html);
  });

  it("does not reinterpret missing or malformed structured data", () => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "| A |\n| --- |");
    expect(readTableRangeFromDataTransfer(transfer)).toBeNull();
    transfer.setData(TABLE_RANGE_CLIPBOARD_MIME, "{bad");
    expect(readTableRangeFromDataTransfer(transfer)).toBeNull();
  });

  it("uses navigator.write only when structured ClipboardItem support exists", async () => {
    const writes: ClipboardItem[][] = [];
    class MockClipboardItem {
      readonly types: string[];
      constructor(readonly data: Record<string, Blob>) { this.types = Object.keys(data); }
      async getType(type: string): Promise<Blob> { return this.data[type]!; }
    }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    const clipboard = {
      write: vi.fn(async (items: ClipboardItem[]) => { writes.push(items); }),
    } as unknown as Clipboard;

    expect(await writeTableRangeToNavigator(clipboard, payload)).toBe(true);
    expect(writes).toHaveLength(1);
    expect((writes[0]![0] as unknown as MockClipboardItem).types).toEqual(expect.arrayContaining([
      TABLE_RANGE_CLIPBOARD_WEB_MIME, "text/plain", "text/html",
    ]));
  });

  it.each(["main", "popout"] as const)("uses the explicit %s window's ClipboardItem and Blob constructors", async (target) => {
    const main = new JSDOM(undefined, { runScripts: "outside-only" });
    const popout = new JSDOM(undefined, { runScripts: "outside-only" });
    const owner = target === "main" ? main.window : popout.window;
    const other = target === "main" ? popout.window : main.window;
    const wrongConstructor = vi.fn(() => { throw new Error("Wrong clipboard realm"); });
    class OwnerClipboardItem {
      readonly types: string[];
      constructor(readonly data: Record<string, Blob>) { this.types = Object.keys(data); }
    }
    Object.defineProperty(owner, "ClipboardItem", { configurable: true, value: OwnerClipboardItem });
    Object.defineProperty(other, "ClipboardItem", { configurable: true, value: wrongConstructor });
    vi.stubGlobal("ClipboardItem", wrongConstructor);
    const writes: ClipboardItem[][] = [];
    const clipboard = {
      write: vi.fn(async (items: ClipboardItem[]) => { writes.push(items); }),
    } as unknown as Clipboard;
    try {
      expect(owner.Array).not.toBe(other.Array);
      expect(owner.Blob).not.toBe(other.Blob);
      expect(await writeTableRangeToNavigator(clipboard, payload, owner as unknown as Window)).toBe(true);
      expect(writes).toHaveLength(1);
      const item = writes[0]![0] as unknown as OwnerClipboardItem;
      expect(item).toBeInstanceOf(OwnerClipboardItem);
      expect(item.types).toEqual([TABLE_RANGE_CLIPBOARD_WEB_MIME, "text/plain", "text/html"]);
      for (const blob of Object.values(item.data)) {
        expect(blob).toBeInstanceOf(owner.Blob);
        expect(blob).not.toBeInstanceOf(other.Blob);
        expect(blob).not.toBeInstanceOf(window.Blob);
      }
      expect(item.data[TABLE_RANGE_CLIPBOARD_WEB_MIME]!.type).toBe(TABLE_RANGE_CLIPBOARD_MIME);
      expect(wrongConstructor).not.toHaveBeenCalled();
    } finally {
      main.window.close();
      popout.window.close();
    }
  });

  it.each(["ClipboardItem", "Blob"] as const)("refuses a window missing %s instead of falling back to global constructors", async (missing) => {
    const realm = new JSDOM(undefined, { runScripts: "outside-only" });
    const globalConstructor = vi.fn();
    vi.stubGlobal("ClipboardItem", globalConstructor);
    Object.defineProperty(realm.window, "ClipboardItem", { configurable: true, value: globalConstructor });
    Object.defineProperty(realm.window, missing, { configurable: true, value: undefined });
    const write = vi.fn();
    try {
      expect(await writeTableRangeToNavigator(
        { write } as unknown as Clipboard, payload, realm.window as unknown as Window,
      )).toBe(false);
      expect(write).not.toHaveBeenCalled();
      expect(globalConstructor).not.toHaveBeenCalled();
    } finally { realm.window.close(); }
  });

  it("refuses a null owner window without using global constructors", async () => {
    const constructor = vi.fn();
    vi.stubGlobal("ClipboardItem", constructor);
    const write = vi.fn();
    expect(await writeTableRangeToNavigator({ write } as unknown as Clipboard, payload, null)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(constructor).not.toHaveBeenCalled();
  });

  it("keeps navigator read and write capability detection independent", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    expect(await writeTableRangeToNavigator({ write: vi.fn() } as unknown as Clipboard, payload)).toBe(false);
    expect(await readTableRangeFromNavigator({ write: vi.fn() } as unknown as Clipboard))
      .toEqual({ kind: "unsupported" });
  });

  it("reads only a valid structured navigator payload", async () => {
    const blob = new Blob([JSON.stringify(payload)], { type: TABLE_RANGE_CLIPBOARD_MIME });
    const clipboard = {
      read: vi.fn(async () => [{
        types: [TABLE_RANGE_CLIPBOARD_WEB_MIME],
        getType: vi.fn(async () => blob),
      }]),
    } as unknown as Clipboard;
    expect(await readTableRangeFromNavigator(clipboard)).toEqual({ kind: "payload", payload });

    const plainOnly = {
      read: vi.fn(async () => [{ types: ["text/plain"], getType: vi.fn() }]),
    } as unknown as Clipboard;
    expect(await readTableRangeFromNavigator(plainOnly)).toEqual({ kind: "failed" });
  });

  it("recovers an Async Copy HTML carrier in the event reader when custom formats are lost", async () => {
    const writes: ClipboardItem[][] = [];
    class MockClipboardItem {
      constructor(readonly data: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    const clipboard = {
      write: vi.fn(async (items: ClipboardItem[]) => { writes.push(items); }),
    } as unknown as Clipboard;
    expect(await writeTableRangeToNavigator(clipboard, payload)).toBe(true);
    const html = await (writes[0]![0] as unknown as MockClipboardItem).data["text/html"]!.text();
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    transfer.setData("text/plain", tableRangeClipboardRepresentations(payload).plain);
    expect(transfer.types).not.toContain(TABLE_RANGE_CLIPBOARD_MIME);
    expect(transfer.types).not.toContain(TABLE_RANGE_CLIPBOARD_WEB_MIME);
    expect(readTableRangeFromDataTransfer(transfer)).toEqual(payload);
  });

  it("recovers an event Copy HTML carrier in the Async reader when custom formats are lost", async () => {
    const transfer = new DataTransfer();
    expect(writeTableRangeToDataTransfer(transfer, payload)).toBe(true);
    const clipboard = htmlOnlyClipboard(transfer.getData("text/html"));
    expect(await readTableRangeFromNavigator(clipboard)).toEqual({ kind: "payload", payload });
  });

  it("preserves entity-like text, quotes, Unicode and raw Markdown through the owned HTML carrier", async () => {
    const rawPayload: TableRangeClipboardPayloadV1 = {
      ...payload,
      rawByOwner: {
        o0: '**中文😀 & "quote" <tag>**',
        o1: String.raw`[[Target\|Alias]]`,
        o2: "`a\\|b`<br>$x$\r\n",
        o3: '&quot; " \\ <script>alert(1)</script>',
      },
    };
    const html = tableRangeClipboardRepresentations(rawPayload).html;
    const transfer = new DataTransfer();
    transfer.setData("text/html", `<!--StartFragment-->${html}<!--EndFragment-->`);
    expect(readTableRangeFromDataTransfer(transfer)).toEqual(rawPayload);
    expect(await readTableRangeFromNavigator(htmlOnlyClipboard(transfer.getData("text/html"))))
      .toEqual({ kind: "payload", payload: rawPayload });
  });

  it.each([
    ["ordinary table", (): string => "<table><tr><td>A</td></tr></table>"],
    ["non-table marker", (): string => carrierHtml(JSON.stringify(payload), "div")],
    ["multiple carriers", (): string => tableRangeClipboardRepresentations(payload).html.repeat(2)],
    ["empty carrier", (): string => carrierHtml("")],
    ["malformed JSON", (): string => carrierHtml("{bad")],
    ["wrong version", (): string => carrierHtml(JSON.stringify({ ...payload, version: 2 }))],
    ["missing owner", (): string => carrierHtml(JSON.stringify({ ...payload, rawByOwner: { o0: "A" } }))],
  ] as const)("rejects %s HTML instead of inferring a range", async (_label, htmlSource) => {
    const html = htmlSource();
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    transfer.setData("text/plain", tableRangeClipboardRepresentations(payload).plain);
    expect(readTableRangeFromDataTransfer(transfer)).toBeNull();
    expect(await readTableRangeFromNavigator(htmlOnlyClipboard(html))).toEqual({ kind: "failed" });
  });

  it.each([TABLE_RANGE_CLIPBOARD_MIME, TABLE_RANGE_CLIPBOARD_WEB_MIME])("does not mask empty or malformed event %s with valid owned HTML", (type) => {
    for (const source of ["", "{bad"]) {
      const transfer = new DataTransfer();
      transfer.setData(type, source);
      transfer.setData("text/html", tableRangeClipboardRepresentations(payload).html);
      expect(transfer.types).toContain(type);
      expect(readTableRangeFromDataTransfer(transfer)).toBeNull();
    }
  });

  it.each([TABLE_RANGE_CLIPBOARD_MIME, TABLE_RANGE_CLIPBOARD_WEB_MIME])("does not mask empty or malformed Async %s with valid owned HTML", async (type) => {
    for (const source of ["", "{bad"]) {
      const getType = vi.fn(async (requested: string) => new Blob([
        requested === type ? source : tableRangeClipboardRepresentations(payload).html,
      ], { type: requested }));
      const clipboard = { read: vi.fn(async () => [{ types: [type, "text/html"], getType }]) } as unknown as Clipboard;
      expect(await readTableRangeFromNavigator(clipboard)).toEqual({ kind: "failed" });
      expect(getType).toHaveBeenCalledTimes(1);
      expect(getType).toHaveBeenCalledWith(type);
    }
  });

  it("keeps custom read errors as failures instead of reading an HTML alternate", async () => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", tableRangeClipboardRepresentations(payload).html);
    const getData = vi.spyOn(transfer, "getData").mockImplementation((type) => {
      if (type !== "text/html") throw new Error("Clipboard read denied");
      return tableRangeClipboardRepresentations(payload).html;
    });
    expect(readTableRangeFromDataTransfer(transfer)).toBeNull();
    expect(getData).not.toHaveBeenCalledWith("text/html");
    const getType = vi.fn(async () => { throw new Error("Clipboard read denied"); });
    const clipboard = { read: vi.fn(async () => [{ types: [TABLE_RANGE_CLIPBOARD_WEB_MIME, "text/html"], getType }]) } as unknown as Clipboard;
    expect(await readTableRangeFromNavigator(clipboard)).toEqual({ kind: "failed" });
    expect(getType).toHaveBeenCalledTimes(1);
    expect(getType).toHaveBeenCalledWith(TABLE_RANGE_CLIPBOARD_WEB_MIME);
  });

  it("does not let an earlier valid HTML item mask a later malformed custom payload", async () => {
    const getHtml = vi.fn(async () => new Blob([tableRangeClipboardRepresentations(payload).html]));
    const getCustom = vi.fn(async () => new Blob(["{bad"]));
    const clipboard = {
      read: vi.fn(async () => [
        { types: ["text/html"], getType: getHtml },
        { types: [TABLE_RANGE_CLIPBOARD_WEB_MIME], getType: getCustom },
      ]),
    } as unknown as Clipboard;
    expect(await readTableRangeFromNavigator(clipboard)).toEqual({ kind: "failed" });
    expect(getCustom).toHaveBeenCalledTimes(1);
    expect(getHtml).not.toHaveBeenCalled();
  });

  it("rejects multiple Async HTML representations instead of selecting an arbitrary carrier", async () => {
    const html = tableRangeClipboardRepresentations(payload).html;
    const clipboard = {
      read: vi.fn(async () => [1, 2].map(() => ({ types: ["text/html"], getType: vi.fn(async () => new Blob([html])) }))),
    } as unknown as Clipboard;
    expect(await readTableRangeFromNavigator(clipboard)).toEqual({ kind: "failed" });
  });

  it("extracts both HTML-only transports with the supplied document instead of the global realm", async () => {
    const realm = new JSDOM(undefined, { runScripts: "outside-only" });
    const html = tableRangeClipboardRepresentations(payload).html;
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    const parse = vi.spyOn(realm.window.DOMParser.prototype, "parseFromString");
    expect(realm.window.DOMParser).not.toBe(window.DOMParser);
    vi.stubGlobal("document", undefined);
    try {
      const ownerDocument = realm.window.document;
      expect(readTableRangeFromDataTransfer(transfer, ownerDocument)).toEqual(payload);
      expect(await readTableRangeFromNavigator(htmlOnlyClipboard(html), ownerDocument))
        .toEqual({ kind: "payload", payload });
      expect(parse).toHaveBeenCalledTimes(2);
      expect(parse).toHaveBeenCalledWith(html, "text/html");
      expect(ownerDocument.body.childElementCount).toBe(0);
    } finally { realm.window.close(); }
  });
});
