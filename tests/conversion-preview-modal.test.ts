// @vitest-environment happy-dom
import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversionPreviewModal } from "../src/app/conversion-preview-modal";

beforeEach(() => {
  HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(
    tag: K, options?: { cls?: string; text?: string },
  ): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    if (options?.text !== undefined) element.textContent = options.text;
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.empty = function(): void { this.replaceChildren(); };
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function openModal(warning?: string) {
  const onConfirm = vi.fn();
  const modal = new ConversionPreviewModal({} as App, {
    title: "Convert table",
    description: "Review source",
    source: "<table></table>",
    cancelLabel: "Cancel",
    confirmLabel: "Replace",
    ...(warning === undefined ? {} : {
      warning,
      acknowledgeLabel: "I accept the loss",
    }),
    onConfirm,
  });
  modal.open();
  const buttons = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>("button"));
  expect(buttons).toHaveLength(2);
  return { modal, onConfirm, cancel: buttons[0]!, confirm: buttons[1]! };
}

describe("table source conversion preview", () => {
  it("blocks source replacement until HTML attribute loss is acknowledged", () => {
    const { modal, onConfirm, confirm } = openModal("Colors and widths will be lost.");
    expect(modal.contentEl.textContent).toContain("Colors and widths will be lost.");
    expect(modal.contentEl.querySelector("pre")?.textContent).toBe("<table></table>");
    expect(confirm.disabled).toBe(true);
    confirm.click();
    expect(onConfirm).not.toHaveBeenCalled();

    const toggle = modal.contentEl.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(toggle).not.toBeNull();
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    expect(confirm.disabled).toBe(false);
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    expect(confirm.disabled).toBe(true);
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    confirm.click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("allows lossless source previews without extra consent", () => {
    const { confirm, onConfirm } = openModal();
    expect(confirm.disabled).toBe(false);
    confirm.click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cancels without invoking replacement", () => {
    const { cancel, onConfirm } = openModal("Styling will be lost.");
    cancel.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
