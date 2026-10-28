import { TABLE_RANGE_CLIPBOARD_MIME, TABLE_RANGE_CLIPBOARD_WEB_MIME } from "../core/table-range-clipboard";

/** The same classifier consumes menu reads and native paste-event data. */
export async function readCellClipboardData(clipboard: Clipboard): Promise<DataTransfer> {
  const data = new Map<string, string>();
  if (typeof clipboard.read === "function") {
    for (const item of await clipboard.read()) {
      for (const type of ["text/plain", "text/html", TABLE_RANGE_CLIPBOARD_MIME, TABLE_RANGE_CLIPBOARD_WEB_MIME]) {
        if (item.types.includes(type)) data.set(type, await (await item.getType(type)).text());
      }
    }
  } else data.set("text/plain", await clipboard.readText());
  return { types: [...data.keys()], getData: (type: string) => data.get(type) ?? "", files: [] } as unknown as DataTransfer;
}
