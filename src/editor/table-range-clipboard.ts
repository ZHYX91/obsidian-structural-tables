import {
  parseTableRangePayload,
  tableRangeHtml,
  tableRangePlainText,
  TABLE_RANGE_CLIPBOARD_MIME,
  TABLE_RANGE_CLIPBOARD_WEB_MIME,
  TABLE_RANGE_HTML_ATTRIBUTE,
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
  ownerDocument: Document = document,
): TableRangeClipboardPayloadV1 | null {
  try {
    for (const type of [TABLE_RANGE_CLIPBOARD_MIME, TABLE_RANGE_CLIPBOARD_WEB_MIME]) {
      const source = transfer.getData(type);
      if (source !== "") return parseTableRangePayload(source);
      if (transfer.types.includes(type)) return null;
    }
    return readOwnedTableRangeHtml(transfer.getData("text/html"), ownerDocument);
  } catch {
    return null;
  }
}

function readOwnedTableRangeHtml(
  html: string,
  ownerDocument: Document,
): TableRangeClipboardPayloadV1 | null {
  const Parser = ownerDocument.defaultView?.DOMParser;
  if (typeof Parser !== "function") return null;
  const parsed = new Parser().parseFromString(html, "text/html");
  const carriers = parsed.querySelectorAll<HTMLTableElement>(`table[${TABLE_RANGE_HTML_ATTRIBUTE}]`);
  if (carriers.length !== 1) return null;
  const source = carriers[0]!.getAttribute(TABLE_RANGE_HTML_ATTRIBUTE);
  return source === null ? null : parseTableRangePayload(source);
}

type ClipboardItemConstructor = new (items: Record<string, Blob>) => ClipboardItem;
type ClipboardOwnerWindow = Window & {
  ClipboardItem?: ClipboardItemConstructor;
  Blob?: typeof Blob;
};

export async function writeTableRangeToNavigator(
  clipboard: Clipboard | undefined,
  payload: TableRangeClipboardPayloadV1,
  ownerWindow: Window | null | undefined = window,
): Promise<boolean> {
  const owner = ownerWindow as ClipboardOwnerWindow | null | undefined;
  const ClipboardItemCtor = owner?.ClipboardItem;
  const BlobCtor = owner?.Blob;
  if (clipboard === undefined || typeof clipboard.write !== "function"
    || typeof ClipboardItemCtor !== "function" || typeof BlobCtor !== "function") return false;
  const representations = tableRangeClipboardRepresentations(payload);
  try {
    const item = new ClipboardItemCtor({
      [TABLE_RANGE_CLIPBOARD_WEB_MIME]: new BlobCtor([representations.structured], { type: TABLE_RANGE_CLIPBOARD_MIME }),
      "text/plain": new BlobCtor([representations.plain], { type: "text/plain" }),
      "text/html": new BlobCtor([representations.html], { type: "text/html" }),
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
  ownerDocument: Document = document,
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
    const htmlItems = items.filter((item) => item.types.includes("text/html"));
    if (htmlItems.length !== 1) return { kind: "failed" };
    const html = await htmlItems[0]!.getType("text/html");
    const payload = readOwnedTableRangeHtml(await html.text(), ownerDocument);
    return payload === null ? { kind: "failed" } : { kind: "payload", payload };
  } catch {
    return { kind: "failed" };
  }
}
