// @vitest-environment happy-dom

import { App, Modal } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../src/config/i18n";
import { recoveredCellDrafts, retainCellDraft, showRecoveredCellDrafts } from "../src/editor/cell-draft-recovery";

beforeAll(() => {
  HTMLElement.prototype.createDiv = function createDiv() { return this.createEl("div"); };
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    return this.appendChild(this.ownerDocument.createElement(tag));
  };
});

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("cell draft recovery", () => {
  it.each(["Notes/ملخص-2026.md", "ملاحظات/تقارير/ملخص-2026.md"])("isolates the display of %s while copying the exact original draft", async (sourcePath) => {
    const app = new App(); const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const draft = { sourcePath, row: 1, column: 2, text: "مرحبا ABC-123 $P(A\\mid B)$" };
    const t = createTranslator("ar"); retainCellDraft(app, draft, t); await Promise.resolve();
    const label = document.querySelector("label")!; const path = label.querySelector<HTMLElement>("bdi")!;
    expect(path.dir).toBe("ltr"); expect(path.textContent).toBe(sourcePath);
    expect([...path.querySelectorAll("bdi")].map((part) => part.textContent)).toEqual(sourcePath.split("/"));
    expect(label.querySelector<HTMLTextAreaElement>("textarea")!.dir).toBe("auto");
    [...document.querySelectorAll("button")].find((button) => button.textContent === t("draft.copy"))!.click();
    expect(write).toHaveBeenCalledWith(draft.text); expect(recoveredCellDrafts(app)).toEqual([draft]);
    expect(JSON.stringify(recoveredCellDrafts(app))).not.toMatch(/\p{Bidi_Control}/u);
  });
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

  it("keeps the original textarea and manual selection when another draft arrives", async () => {
    const app = new App();
    const t = createTranslator("en");
    const draft = { sourcePath: "A.md", row: 0, column: 0, text: "Original" };
    retainCellDraft(app, draft, t); await Promise.resolve();
    const text = document.querySelector("textarea")!;
    text.focus(); text.setSelectionRange(1, 6);
    retainCellDraft(app, { ...draft, sourcePath: "B.md" }, t); await Promise.resolve();
    expect(document.activeElement).toBe(text);
    expect(text.isConnected).toBe(true);
    expect(text.value.slice(text.selectionStart, text.selectionEnd)).toBe("rigin");
    expect(document.querySelectorAll("textarea")).toHaveLength(2);
  });

  it("offers manual copying even when the host omits the Clipboard API", async () => {
    const app = new App();
    const t = createTranslator("en");
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue(undefined as unknown as Clipboard);
    retainCellDraft(app, { sourcePath: "A.md", row: 0, column: 0, text: "Original" }, t);
    await Promise.resolve();
    [...document.querySelectorAll("button")].find((button) => button.textContent === t("draft.copy"))!.click();
    const text = document.querySelector("textarea")!;
    await vi.waitFor(() => expect(document.activeElement).toBe(text));
    expect(text.value.slice(text.selectionStart, text.selectionEnd)).toBe("Original");
    expect(recoveredCellDrafts(app)).toHaveLength(1);
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
