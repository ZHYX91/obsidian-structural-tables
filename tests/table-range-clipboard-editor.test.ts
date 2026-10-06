// @vitest-environment happy-dom
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
  vi.unstubAllGlobals();
});

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
});
