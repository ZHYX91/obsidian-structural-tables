import { TABLE_RANGE_CLIPBOARD_MIME, TABLE_RANGE_CLIPBOARD_WEB_MIME } from "../core/table-range-clipboard";

/** The same classifier consumes menu reads and native paste-event data. */
export async function readCellClipboardData(clipboard: Clipboard): Promise<DataTransfer> {
  const data = new Map<string, string>();
  if (typeof clipboard.read === "function") {
    const types = ["text/plain", "text/html", TABLE_RANGE_CLIPBOARD_MIME, TABLE_RANGE_CLIPBOARD_WEB_MIME];
    const items = (await clipboard.read()).filter((item) => types.some((type) => item.types.includes(type)));
    if (items.length > 1) throw new Error("Cannot paste multiple clipboard items into one draft");
    const item = items[0];
    if (item !== undefined) {
      for (const type of types) {
        if (item.types.includes(type)) data.set(type, await (await item.getType(type)).text());
      }
    }
  } else data.set("text/plain", await clipboard.readText());
  return { types: [...data.keys()], getData: (type: string) => data.get(type) ?? "", files: [] } as unknown as DataTransfer;
}
