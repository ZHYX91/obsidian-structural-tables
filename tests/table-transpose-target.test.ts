// @vitest-environment happy-dom

import type { App, Editor, TFile as HostFile } from "obsidian";
import { MarkdownView } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createTranslator } from "../src/config/i18n";
import { parseEditableTables } from "../src/core/parser";
import { captureEditorTransposeTarget } from "../src/editor/table-transpose-target";
import { requestWholeTableTranspose } from "../src/app/table-transpose-modal";
import { notices, TFile } from "./mocks/obsidian";
import { clickLikeUser } from "./helpers/host-gestures";

const t = createTranslator("en");
const SOURCE = "| Name | Value |\n| --- | --- |\n| North | 1 |";

function editorState(initial = SOURCE) {
  let source = initial;
  const replaceRange = vi.fn((text: string, from: { ch: number }, to: { ch: number }) => {
    source = source.slice(0, from.ch) + text + source.slice(to.ch);
  });
  const editor = {
    getValue: () => source,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    replaceRange,
    setCursor: vi.fn(),
  } as unknown as Editor;
  return { editor, replaceRange, source: () => source, setSource: (next: string) => { source = next; } };
}

function fixture(doc = document) {
  const files = new Map<string, TFile>();
  const leaves: Array<{ view: MarkdownView }> = [];
  const app = {
    vault: { getFileByPath: (path: string) => files.get(path) ?? null },
    workspace: {
      containerEl: document.body,
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => {
        for (const leaf of leaves) callback(leaf);
      },
    },
  } as unknown as App;
  const file = new TFile("A.md");
  files.set(file.path, file);
  const state = editorState();
  const containerEl = doc.body.appendChild(doc.createElement("div"));
  const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
    file, editor: state.editor, containerEl,
  });
  leaves.push({ view });
  const table = parseEditableTables(SOURCE).tables[0]!;
  return { app, file, files, leaves, state, view, table, containerEl };
}

beforeAll(() => {
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K, options?: { text?: string },
  ): HTMLElementTagNameMap[K] {
    const node = this.ownerDocument.createElement(tag);
    if (options?.text !== undefined) node.textContent = options.text;
    this.appendChild(node);
    return node;
  };
  HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
});
afterEach(() => { document.body.replaceChildren(); notices.length = 0; });

describe("frozen transpose editor ownership", () => {
  it("writes once only to the original editor while its original file and source remain current", () => {
    const f = fixture();
    const target = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view);
    expect(target).not.toBeNull();
    expect(target!.isCurrent()).toBe(true);
    requestWholeTableTranspose(f.app, t, f.table, target!);
    expect(f.state.replaceRange).not.toHaveBeenCalled();
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Transpose anyway");
    expect(confirm).toBeDefined();
    clickLikeUser(confirm!);
    expect(f.state.replaceRange).toHaveBeenCalledTimes(1);
    expect(parseEditableTables(f.state.source()).tables[0]?.rowHeaderColumnCount).toBe(1);
  });

  it("rejects a view rebound to another file even when its Markdown bytes and offset are identical", () => {
    const f = fixture();
    const original = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view)!;
    const b = new TFile("B.md");
    f.files.set("B.md", b);
    f.view.file = b as unknown as HostFile;
    expect(original.isCurrent()).toBe(false);
    original.apply();
    expect(f.state.source()).toBe(SOURCE);
    expect(f.state.replaceRange).not.toHaveBeenCalled();
  });

  it("rejects editor rebind, file rename, detached view, and host disposal", () => {
    const f = fixture();
    let active = true;
    const target = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view, () => active)!;
    const substitute = editorState().editor;
    f.view.editor = substitute;
    expect(target.isCurrent()).toBe(false);
    f.view.editor = f.state.editor;
    f.file.path = "Moved.md";
    expect(target.isCurrent()).toBe(false);
    f.file.path = "A.md";
    f.containerEl.remove();
    expect(target.isCurrent()).toBe(false);
    document.body.appendChild(f.containerEl);
    active = false;
    expect(target.isCurrent()).toBe(false);
  });

  it("rejects an obsolete table after edits while preserving unrelated notes", () => {
    const f = fixture();
    const target = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view)!;
    f.state.setSource(SOURCE.replace("North", "South"));
    target.apply();
    expect(f.state.source()).toContain("South");
    expect(f.state.replaceRange).not.toHaveBeenCalled();
  });

  it("checks drafts in the target popout document, not the main window", () => {
    const frame = document.body.appendChild(document.createElement("iframe"));
    const popup = frame.contentWindow!;
    const f = fixture(popup.document);
    const target = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view)!;
    expect(target.ownerDocument).toBe(popup.document);
    const draft = f.containerEl.appendChild(popup.document.createElement("textarea"));
    draft.className = "structural-tables-cell-editor";
    draft.value = "unfinished";
    requestWholeTableTranspose(f.app, t, f.table, target);
    expect(f.state.replaceRange).not.toHaveBeenCalled();
    expect(draft.value).toBe("unfinished");
    expect(notices[notices.length - 1]).toContain("active cell draft");
  });

  it("refuses a stale file after opening a modal, before the confirmation click", () => {
    const f = fixture();
    const target = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view)!;
    requestWholeTableTranspose(f.app, t, f.table, target);
    const b = new TFile("B.md");
    f.files.set(b.path, b);
    f.view.file = b as unknown as HostFile;
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Transpose anyway");
    expect(confirm).toBeDefined();
    clickLikeUser(confirm!);
    expect(f.state.replaceRange).not.toHaveBeenCalled();
    expect(f.state.source()).toBe(SOURCE);
    expect(notices[notices.length - 1]).toContain("changed");
  });
});
