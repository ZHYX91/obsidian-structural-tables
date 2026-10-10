import { App, Modal, Platform, type EventRef } from "obsidian";

import type { Translate } from "../config/i18n";
import { renderTableImage, TableImageError, type TableImage, type TableImageRequest } from "../rendering/table-image";

export interface TableImageModalOptions extends Omit<TableImageRequest, "document" | "signal"> {
  t: Translate;
  onClose: () => void;
}

export function tableImageFilename(sourcePath: string): string {
  const name = sourcePath.split("/").pop()?.replace(/\.md$/iu, "") ?? "table";
  const printable = Array.from(name, (char) => char.charCodeAt(0) < 32 ? "_" : char).join("");
  return `${printable.replace(/[<>:"/\\|?*]/gu, "_") || "table"}-table.png`;
}

export async function copyTableImage(image: TableImage, document: Document): Promise<void> {
  const view = document.defaultView;
  const clipboard = view?.navigator.clipboard;
  const Item = (view as (Window & { ClipboardItem?: typeof ClipboardItem }) | null)?.ClipboardItem;
  if (Platform.isMobileApp || clipboard?.write === undefined || Item === undefined) throw new Error("unsupported");
  await clipboard.write([new Item({ "image/png": image.blob })]);
}

export async function saveTableImage(app: App, image: TableImage, sourcePath: string, signal: AbortSignal): Promise<string> {
  const path = await app.fileManager.getAvailablePathForAttachment(tableImageFilename(sourcePath), sourcePath);
  const bytes = await image.blob.arrayBuffer();
  signal.throwIfAborted();
  // createBinary refuses an existing path. Never overwrite or insert a note link.
  await app.vault.createBinary(path, bytes);
  return path;
}

/** The preview, clipboard and save all share one completed PNG Blob. */
export class TableImageModal extends Modal {
  private readonly controller = new AbortController();
  private url: string | null = null;
  private image: TableImage | null = null;
  private busy = false;
  private closed = false;
  private copyAvailable = false;
  private status!: HTMLElement;
  private copy!: HTMLButtonElement;
  private save!: HTMLButtonElement;

  constructor(app: App, private readonly options: TableImageModalOptions) { super(app); }

  override onOpen(): void {
    const { t } = this.options;
    this.setTitle(t("image.title"));
    this.contentEl.classList.add("structural-tables-image-modal");
    this.contentEl.createEl("p", { text: t("image.description") });
    this.status = this.contentEl.createEl("p", { text: t("image.rendering"), attr: { role: "status", "aria-live": "polite" } });
    const preview = this.contentEl.createDiv({ cls: "structural-tables-image-preview" });
    const actions = this.contentEl.createDiv({ cls: "structural-tables-image-actions" });
    this.copy = actions.createEl("button", { text: t("image.copy") });
    this.save = actions.createEl("button", { text: t("image.save") });
    const cancel = actions.createEl("button", { text: t("modal.cancel") });
    cancel.addEventListener("click", () => this.close());
    this.copy.disabled = true;
    this.save.disabled = true;
    this.copy.addEventListener("click", () => { void this.copyImage(); });
    this.save.addEventListener("click", () => { void this.saveImage(); });
    if (Platform.isMobileApp) {
      this.status.textContent = t("image.desktopOnly");
      return;
    }
    void this.prepare(preview);
  }

  private async prepare(preview: HTMLElement): Promise<void> {
    const { t } = this.options;
    try {
      const image = await renderTableImage(this.app, { ...this.options,
        document: this.contentEl.ownerDocument, signal: this.controller.signal });
      if (this.closed) return;
      this.image = image;
      this.url = this.contentEl.ownerDocument.defaultView!.URL.createObjectURL(image.blob);
      preview.createEl("img", { attr: { src: this.url, alt: t("image.previewAlt") } });
      const clipboardAvailable = this.contentEl.ownerDocument.defaultView?.navigator.clipboard?.write !== undefined
        && (this.contentEl.ownerDocument.defaultView as Window & { ClipboardItem?: unknown }).ClipboardItem !== undefined;
      this.copyAvailable = clipboardAvailable;
      this.copy.disabled = !clipboardAvailable;
      this.save.disabled = false;
      this.status.textContent = t(clipboardAvailable ? "image.ready" : "image.copyUnavailable")
        .replace("{width}", String(image.width)).replace("{height}", String(image.height));
    } catch (error) {
      if (this.closed) return;
      const key = error instanceof TableImageError ? `image.error.${error.code}` as const : "image.error.resource";
      this.status.textContent = t(key);
    }
  }

  private async copyImage(): Promise<void> {
    if (this.busy || this.closed || this.image === null) return;
    this.busy = true;
    this.copy.disabled = true;
    this.save.disabled = true;
    try {
      await copyTableImage(this.image, this.contentEl.ownerDocument);
      if (!this.closed) this.status.textContent = this.options.t("image.copied");
    } catch {
      if (!this.closed) this.status.textContent = this.options.t("image.copyFailed");
    } finally { this.busy = false; if (!this.closed) { this.copy.disabled = !this.copyAvailable; this.save.disabled = false; } }
  }

  private async saveImage(): Promise<void> {
    if (this.busy || this.closed || this.image === null) return;
    this.busy = true;
    this.save.disabled = true;
    this.copy.disabled = true;
    try {
      const path = await saveTableImage(this.app, this.image, this.options.sourcePath, this.controller.signal);
      if (!this.closed) this.status.textContent = this.options.t("image.saved").replace("{path}", path);
    } catch {
      if (!this.closed) this.status.textContent = this.options.t("image.saveFailed");
    } finally { this.busy = false; if (!this.closed) { this.copy.disabled = !this.copyAvailable; this.save.disabled = false; } }
  }

  override onClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    if (this.url !== null) this.contentEl.ownerDocument.defaultView!.URL.revokeObjectURL(this.url);
    this.url = null;
    this.image = null;
    this.contentEl.empty();
    this.options.onClose();
  }
}

export type ExportTableImage = (table: TableImageRequest["table"], sourcePath: string,
  isCurrent: () => boolean, contextElement?: HTMLElement) => void;

/** One export session per plugin; a repeated request cancels the previous one. */
export class TableImageExportService {
  private modal: TableImageModal | null = null;
  constructor(private readonly app: App, private readonly options: () => Pick<TableImageModalOptions, "settings" | "t">) {}
  readonly open: ExportTableImage = (table, sourcePath, isCurrent, contextElement) => {
    this.modal?.close();
    let unchanged = true;
    const events: EventRef[] = [
      this.app.vault.on("modify", (file) => { if (file.path === sourcePath) unchanged = false; }),
      this.app.vault.on("rename", (file, oldPath) => { if (oldPath === sourcePath || file.path === sourcePath) unchanged = false; }),
      this.app.vault.on("delete", (file) => { if (file.path === sourcePath) unchanged = false; }),
    ];
    const modal = new TableImageModal(this.app, { ...this.options(), table, sourcePath,
      ...(contextElement === undefined ? {} : { contextElement }),
      isCurrent: () => unchanged && isCurrent(),
      onClose: () => {
        for (const event of events) this.app.vault.offref(event);
        if (this.modal === modal) this.modal = null;
      } });
    this.modal = modal;
    modal.open();
  };
  close(): void { this.modal?.close(); }
}
