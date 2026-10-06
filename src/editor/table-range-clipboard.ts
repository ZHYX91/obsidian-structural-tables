import {
  parseTableRangePayload,
  tableRangeHtml,
  tableRangePlainText,
  TABLE_RANGE_CLIPBOARD_MIME,
  TABLE_RANGE_CLIPBOARD_WEB_MIME,
  type TableRangeClipboardPayloadV1,
} from "../core/table-range-clipboard";

export interface TableRangeClipboardRepresentations {
  structured: string;
  plain: string;
  html: string;
}

export function tableRangeClipboardRepresentations(
  payload: TableRangeClipboardPayloadV1,
): TableRangeClipboardRepresentations {
  return {
    structured: JSON.stringify(payload),
    plain: tableRangePlainText(payload),
    html: tableRangeHtml(payload),
  };
}

export function writeTableRangeToDataTransfer(
  transfer: DataTransfer,
  payload: TableRangeClipboardPayloadV1,
): boolean {
  const representations = tableRangeClipboardRepresentations(payload);
  try {
    transfer.setData(TABLE_RANGE_CLIPBOARD_MIME, representations.structured);
    transfer.setData("text/plain", representations.plain);
    transfer.setData("text/html", representations.html);
    return transfer.getData(TABLE_RANGE_CLIPBOARD_MIME) === representations.structured;
  } catch {
    return false;
  }
}

export function readTableRangeFromDataTransfer(
  transfer: DataTransfer,
): TableRangeClipboardPayloadV1 | null {
  try {
    const source = transfer.getData(TABLE_RANGE_CLIPBOARD_MIME);
    return source === "" ? null : parseTableRangePayload(source);
  } catch {
    return null;
  }
}

type ClipboardItemConstructor = new (items: Record<string, Blob>) => ClipboardItem;

function clipboardItemConstructor(): ClipboardItemConstructor | null {
  const value = (globalThis as typeof globalThis & { ClipboardItem?: ClipboardItemConstructor }).ClipboardItem;
  return typeof value === "function" ? value : null;
}

export async function writeTableRangeToNavigator(
  clipboard: Clipboard | undefined,
  payload: TableRangeClipboardPayloadV1,
): Promise<boolean> {
  const ClipboardItemCtor = clipboardItemConstructor();
  if (clipboard === undefined || typeof clipboard.write !== "function" || ClipboardItemCtor === null) return false;
  const representations = tableRangeClipboardRepresentations(payload);
  try {
    const item = new ClipboardItemCtor({
      [TABLE_RANGE_CLIPBOARD_WEB_MIME]: new Blob([representations.structured], { type: TABLE_RANGE_CLIPBOARD_MIME }),
      "text/plain": new Blob([representations.plain], { type: "text/plain" }),
      "text/html": new Blob([representations.html], { type: "text/html" }),
    });
    await clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

export type NavigatorRangeRead =
  | { kind: "payload"; payload: TableRangeClipboardPayloadV1 }
  | { kind: "unsupported" }
  | { kind: "failed" };

export async function readTableRangeFromNavigator(
  clipboard: Clipboard | undefined,
): Promise<NavigatorRangeRead> {
  if (clipboard === undefined || typeof clipboard.read !== "function") return { kind: "unsupported" };
  try {
    const items = await clipboard.read();
    for (const item of items) {
      const structuredType = item.types.includes(TABLE_RANGE_CLIPBOARD_WEB_MIME)
        ? TABLE_RANGE_CLIPBOARD_WEB_MIME
        : item.types.includes(TABLE_RANGE_CLIPBOARD_MIME) ? TABLE_RANGE_CLIPBOARD_MIME : null;
      if (structuredType === null) continue;
      const blob = await item.getType(structuredType);
      const payload = parseTableRangePayload(await blob.text());
      return payload === null ? { kind: "failed" } : { kind: "payload", payload };
    }
    return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}
