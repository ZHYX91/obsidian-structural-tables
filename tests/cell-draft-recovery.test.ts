// @vitest-environment happy-dom

import { App, Modal } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../src/config/i18n";
import { recoveredCellDrafts, retainCellDraft, showRecoveredCellDrafts } from "../src/editor/cell-draft-recovery";

beforeAll(() => {
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    return this.appendChild(this.ownerDocument.createElement(tag));
  };
});

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("cell draft recovery", () => {
  it("keeps dismissed drafts available and discards only the explicitly selected draft", async () => {
    const app = new App();
    const opened = vi.spyOn(Modal.prototype, "open");
    const first = { sourcePath: "A.md", row: 1, column: 2, text: "Unsaved 中文" };
    retainCellDraft(app, first, createTranslator("en"));
    await Promise.resolve();
    expect(recoveredCellDrafts(app)).toEqual([first]);
    (opened.mock.instances[0] as Modal).close();
    expect(recoveredCellDrafts(app)).toEqual([first]);
    showRecoveredCellDrafts(app, createTranslator("en"));
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(first.text);
    retainCellDraft(app, { ...first, sourcePath: "B.md", text: "Second" }, createTranslator("en"));
    await Promise.resolve();
    [...document.querySelectorAll("button")].find((button) => button.textContent === "Discard draft")!.click();
    expect(recoveredCellDrafts(app).map((draft) => draft.text)).toEqual(["Second"]);
  });

  it("retains the draft and selects it for manual copying when clipboard access fails", async () => {
    const app = new App();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("unavailable"));
    retainCellDraft(app, { sourcePath: "A.md", row: 0, column: 0, text: "Keep me" }, createTranslator("en"));
    await Promise.resolve();
    [...document.querySelectorAll("button")].find((button) => button.textContent === "Copy draft")!.click();
    await vi.waitFor(() => expect(document.activeElement?.tagName).toBe("TEXTAREA"));
    const text = document.activeElement as HTMLTextAreaElement;
    expect(text.value.slice(text.selectionStart, text.selectionEnd)).toBe("Keep me");
    expect(recoveredCellDrafts(app)).toHaveLength(1);
  });
});
