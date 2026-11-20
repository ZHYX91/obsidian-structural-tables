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

export type TableRangeClipboardRead =
  | { kind: "payload"; payload: TableRangeClipboardPayloadV1 }
  | { kind: "none" }
  | { kind: "invalid" };

export function readTableRangeFromDataTransfer(
  transfer: DataTransfer,
  ownerDocument: Document = document,
): TableRangeClipboardRead {
  try {
    for (const type of [TABLE_RANGE_CLIPBOARD_MIME, TABLE_RANGE_CLIPBOARD_WEB_MIME]) {
      const source = transfer.getData(type);
      if (source !== "") {
        const payload = parseTableRangePayload(source);
        return payload === null ? { kind: "invalid" } : { kind: "payload", payload };
      }
      if (transfer.types?.includes(type)) return { kind: "invalid" };
    }
    return readOwnedTableRangeHtml(transfer.getData("text/html"), ownerDocument);
  } catch {
    return { kind: "invalid" };
  }
}

function readOwnedTableRangeHtml(
  html: string,
  ownerDocument: Document,
): TableRangeClipboardRead {
  if (html === "") return { kind: "none" };
  const Parser = ownerDocument.defaultView?.DOMParser;
  if (typeof Parser !== "function") return { kind: "invalid" };
  const parsed = new Parser().parseFromString(html, "text/html");
  // An attribute claims an owned payload; its name in ordinary text does not.
  // Keep malformed claims distinct so cell paste cannot downgrade them to text.
  if (parsed.querySelector(`[${TABLE_RANGE_HTML_ATTRIBUTE}]`) === null) {
    // This is only a fast prefilter; ownership still requires a DOM attribute.
    if (!html.toLowerCase().includes(TABLE_RANGE_HTML_ATTRIBUTE)) return { kind: "none" };
    // Document parsing drops orphaned table fragments such as td/tr. Parse them
    // in an inert template context; neither this document nor its fragment enters UI.
    const fragmentDocument = new Parser().parseFromString("<template></template>", "text/html");
    const range = fragmentDocument.createRange();
    range.selectNodeContents(fragmentDocument.querySelector("template")!);
    // eslint-disable-next-line no-unsanitized/method -- Detached inert parsing only; the fragment is inspected, never attached or cloned into UI.
    const fragment = range.createContextualFragment(html);
    return { kind: fragment.querySelector(`[${TABLE_RANGE_HTML_ATTRIBUTE}]`) === null ? "none" : "invalid" };
  }
  const carriers = parsed.querySelectorAll<HTMLTableElement>(`table[${TABLE_RANGE_HTML_ATTRIBUTE}]`);
  if (carriers.length !== 1) return { kind: "invalid" };
  const source = carriers[0]!.getAttribute(TABLE_RANGE_HTML_ATTRIBUTE);
  const payload = source === null ? null : parseTableRangePayload(source);
  return payload === null ? { kind: "invalid" } : { kind: "payload", payload };
}

type ClipboardItemConstructor = new (items: Record<string, Blob>) => ClipboardItem;
type ClipboardOwnerWindow = Window & {
  ClipboardItem?: ClipboardItemConstructor;
  Blob?: typeof Blob;
};

export type RangeClipboardTransport = "rich" | "verified-text";

interface TextRangeCopy {
  plain: string;
  structured: string;
  verified: boolean;
}

// Mobile hosts may route ClipboardItem writes through an image-only bridge.
// Keep topology in this plugin session, and recover it only while the real
// system clipboard still contains the exact plain-text copy we verified.
const textRangeCopies = new WeakMap<Clipboard, TextRangeCopy>();

async function writeVerifiedTextRange(
  clipboard: Clipboard | undefined,
  payload: TableRangeClipboardPayloadV1,
): Promise<boolean> {
  if (clipboard === undefined || typeof clipboard.writeText !== "function"
    || typeof clipboard.readText !== "function") return false;
  const represented = tableRangeClipboardRepresentations(payload);
  const copy: TextRangeCopy = { plain: represented.plain, structured: represented.structured, verified: false };
  textRangeCopies.set(clipboard, copy);
  try {
    await clipboard.writeText(copy.plain);
    const actual = await clipboard.readText();
    if (textRangeCopies.get(clipboard) !== copy) return false;
    if (actual !== copy.plain) {
      textRangeCopies.delete(clipboard);
      return false;
    }
    copy.verified = true;
    return true;
  } catch {
    if (textRangeCopies.get(clipboard) === copy) textRangeCopies.delete(clipboard);
    return false;
  }
}

export async function writeTableRangeToNavigator(
  clipboard: Clipboard | undefined,
  payload: TableRangeClipboardPayloadV1,
  ownerWindow: Window | null | undefined = window,
  transport: RangeClipboardTransport = "rich",
): Promise<boolean> {
  const owner = ownerWindow as ClipboardOwnerWindow | null | undefined;
  if (owner == null) return false;
  if (transport === "verified-text") return writeVerifiedTextRange(clipboard, payload);
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
  transport: RangeClipboardTransport = "rich",
): Promise<NavigatorRangeRead> {
  if (transport === "verified-text") {
    if (clipboard === undefined || typeof clipboard.readText !== "function") return { kind: "unsupported" };
    const copy = textRangeCopies.get(clipboard);
    if (copy?.verified !== true) return { kind: "failed" };
    try {
      const actual = await clipboard.readText();
      if (textRangeCopies.get(clipboard) !== copy) return { kind: "failed" };
      if (actual !== copy.plain) {
        textRangeCopies.delete(clipboard);
        return { kind: "failed" };
      }
      const payload = parseTableRangePayload(copy.structured);
      return payload === null ? { kind: "failed" } : { kind: "payload", payload };
    } catch {
      return { kind: "failed" };
    }
  }
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
    const result = readOwnedTableRangeHtml(await html.text(), ownerDocument);
    return result.kind === "payload" ? result : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}
