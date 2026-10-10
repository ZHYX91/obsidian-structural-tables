// @vitest-environment happy-dom
import { App, Component, Platform } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copyTableImage, saveTableImage, TableImageExportService, TableImageModal, tableImageFilename } from "../src/app/table-image-modal";
import { createTranslator } from "../src/config/i18n";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import { TableImageError } from "../src/rendering/table-image";
import { installReadingImageMenu } from "../src/reading/table-image-menu";
import { lastMenu, MarkdownView, notices, TFile } from "./mocks/obsidian";

const pipeline = vi.hoisted(() => ({ renderTableImage: vi.fn() }));
vi.mock("../src/rendering/table-image", async (original) => ({ ...await original<object>(), ...pipeline }));
const png = { blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), width: 100, height: 200 };
const source = "| A | B |\n| --- | --- |\n| x | y |";
const table = parseEditableTables(source).tables[0]!;

function appHarness() {
  const getAvailablePathForAttachment = vi.fn().mockResolvedValue("attachments/Note-table 1.png");
  const createBinary = vi.fn().mockResolvedValue(new TFile("attachments/Note-table 1.png"));
  const on = vi.fn().mockImplementation((name: string, callback: (...args: unknown[]) => void) => ({ name, callback }));
  const offref = vi.fn();
  const app = Object.assign(new App(), { fileManager: { getAvailablePathForAttachment }, vault: { createBinary, on, offref } });
  return { app, getAvailablePathForAttachment, createBinary, on, offref };
}
function options(onClose = vi.fn()) {
  return { table, sourcePath: "folder/Note.md", settings: DEFAULT_SETTINGS, isCurrent: () => true,
    t: createTranslator("en"), onClose };
}
async function prepared(modal: TableImageModal): Promise<void> {
  modal.open();
  await vi.waitFor(() => expect(modal.contentEl.querySelector("img")).not.toBeNull());
}

beforeEach(() => {
  HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    if (options?.text !== undefined) element.textContent = options.text;
    for (const [key, value] of Object.entries(options?.attr ?? {})) element.setAttribute(key, value);
    this.append(element); return element;
  };
  HTMLElement.prototype.createDiv = function(options?: { cls?: string }): HTMLDivElement { return this.createEl("div", options); };
  HTMLElement.prototype.empty = function(): void { this.replaceChildren(); };
  pipeline.renderTableImage.mockReset().mockResolvedValue(png);
  vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:final-png");
  vi.spyOn(window.URL, "revokeObjectURL").mockImplementation(() => undefined);
  Object.defineProperty(window, "ClipboardItem", { configurable: true, value: class {
    constructor(readonly data: Record<string, Blob>) {}
  } });
});
afterEach(() => { Platform.isMobileApp = false; document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("PNG preview and outputs", () => {
  it("previews, copies and saves the same PNG bytes through public APIs without editing Markdown", async () => {
    const harness = appHarness();
    const modal = new TableImageModal(harness.app, options());
    const write = vi.spyOn(window.navigator.clipboard, "write").mockResolvedValue();
    await prepared(modal);
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(png.blob);
    expect(modal.contentEl.querySelector("img")?.src).toBe("blob:final-png");
    const [copy, save] = modal.contentEl.querySelectorAll("button");
    copy!.click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain("Image copied."));
    expect((write.mock.calls[0]![0][0] as unknown as { data: Record<string, Blob> }).data["image/png"]).toBe(png.blob);
    save!.click();
    await vi.waitFor(() => expect(harness.createBinary).toHaveBeenCalledOnce());
    expect(harness.getAvailablePathForAttachment).toHaveBeenCalledWith("Note-table.png", "folder/Note.md");
    expect(new Uint8Array(harness.createBinary.mock.calls[0]![1])).toEqual(new Uint8Array(await png.blob.arrayBuffer()));
    expect(modal.contentEl.textContent).toContain("attachments/Note-table 1.png");
    modal.close();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:final-png");
  });

  it("retains saving after denied copy, reports failed saving, and prevents repeated writes", async () => {
    const harness = appHarness();
    const modal = new TableImageModal(harness.app, options());
    vi.spyOn(window.navigator.clipboard, "write").mockRejectedValue(new Error("denied"));
    await prepared(modal);
    const [copy, save] = modal.contentEl.querySelectorAll("button");
    copy!.click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain("Image copy failed"));
    expect(save!.disabled).toBe(false);
    harness.createBinary.mockRejectedValue(new Error("write denied"));
    save!.click(); save!.click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain("could not be saved"));
    expect(harness.createBinary).toHaveBeenCalledOnce();
    modal.close();
  });

  it("cancels pending generation on close and does not publish a late result", async () => {
    let finish!: (value: typeof png) => void;
    pipeline.renderTableImage.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const close = vi.fn();
    const modal = new TableImageModal(appHarness().app, options(close)); modal.open();
    const request = pipeline.renderTableImage.mock.calls[0]![1];
    modal.close(); modal.close(); finish(png); await Promise.resolve();
    expect(request.signal.aborted).toBe(true);
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports resource errors and mobile capability without rasterizing or copying", async () => {
    pipeline.renderTableImage.mockRejectedValue(new TableImageError("too-large"));
    const modal = new TableImageModal(appHarness().app, options()); modal.open();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain("exceeds the export limit")); modal.close();
    Platform.isMobileApp = true;
    const mobile = new TableImageModal(appHarness().app, options()); mobile.open();
    expect(mobile.contentEl.textContent).toContain("available on desktop");
    expect(pipeline.renderTableImage).toHaveBeenCalledOnce();
    await expect(copyTableImage(png, document)).rejects.toThrow("unsupported"); mobile.close();
  });

  it("cancels a superseded session, watches source identity and removes Vault subscriptions on unload", async () => {
    const harness = appHarness();
    const service = new TableImageExportService(harness.app, () => ({ settings: DEFAULT_SETTINGS, t: createTranslator("en") }));
    service.open(table, "Note.md", () => true);
    const request = pipeline.renderTableImage.mock.calls[0]![1];
    const modify = harness.on.mock.calls.find(([name]) => name === "modify")![1];
    modify(new TFile("Another.md")); expect(request.isCurrent()).toBe(true);
    modify(new TFile("Note.md")); expect(request.isCurrent()).toBe(false);
    service.open(table, "Note.md", () => true);
    expect(request.signal.aborted).toBe(true);
    expect(harness.offref).toHaveBeenCalledTimes(3);
    service.close(); expect(harness.offref).toHaveBeenCalledTimes(6);
  });

  it("checks cancellation before the public file write and sanitizes the attachment filename", async () => {
    const harness = appHarness(); const controller = new AbortController(); controller.abort(new Error("closed"));
    await expect(saveTableImage(harness.app, png, "folder/Note.md", controller.signal)).rejects.toThrow("closed");
    expect(harness.createBinary).not.toHaveBeenCalled();
    expect(tableImageFilename('folder/a:b?.MD')).toBe("a_b_-table.png");
  });

  it("keeps Reading menus source-verified and component-owned, without changing standalone DOM", async () => {
    const harness = appHarness();
    const file = new TFile("Note.md");
    const cachedRead = vi.fn().mockResolvedValue(source);
    Object.assign(harness.app.vault, { getAbstractFileByPath: () => file, cachedRead });
    const owner = new Component();
    const pane = document.body.appendChild(document.createElement("div")); pane.className = "markdown-preview-view";
    const wrapper = pane.appendChild(document.createElement("div"));
    const view = new MarkdownView(); view.file = file; view.containerEl = pane;
    Object.assign(harness.app, { workspace: { iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => callback({ view }) } });
    const exportImage = vi.fn();
    const translator = () => createTranslator("en");
    installReadingImageMenu(harness.app, wrapper, table, "Note.md", owner, translator, exportImage);
    wrapper.dispatchEvent(new MouseEvent("contextmenu"));
    lastMenu!.items.find((item) => item.title.includes("Export whole"))!.callback!();
    await vi.waitFor(() => expect(exportImage).toHaveBeenCalledOnce());
    expect(exportImage.mock.calls[0]![2]()).toBe(true);
    expect(exportImage.mock.calls[0]![3]).toBe(wrapper);
    owner.unload();
    wrapper.remove();
    expect(exportImage.mock.calls[0]![2]()).toBe(true);
    view.file = new TFile("Other.md");
    expect(exportImage.mock.calls[0]![2]()).toBe(false);
    view.file = file; pane.append(wrapper);
    const second = new Component();
    installReadingImageMenu(harness.app, wrapper, table, "Note.md", second, translator, exportImage);
    cachedRead.mockResolvedValue(source.replace("x", "changed"));
    wrapper.dispatchEvent(new MouseEvent("contextmenu"));
    lastMenu!.items.find((item) => item.title.includes("Export whole"))!.callback!();
    await vi.waitFor(() => expect(notices).toContain(createTranslator("en")("notice.staleTable")));
    expect(exportImage).toHaveBeenCalledOnce(); second.unload();
    const standalone = document.createElement("div");
    installReadingImageMenu(harness.app, standalone, table, "Note.md", new Component(), translator);
    expect(standalone.childElementCount).toBe(0);
  });
});
