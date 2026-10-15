// @vitest-environment happy-dom

import type { App, Editor, TFile as HostFile } from "obsidian";
import { MarkdownView, editorInfoField } from "obsidian";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createTranslator } from "../src/config/i18n";
import { parseEditableTables } from "../src/core/parser";
import { captureEditorTransposeTarget } from "../src/editor/table-transpose-target";
import { requestWholeTableTranspose } from "../src/app/table-transpose-modal";
import { notices, TFile } from "./mocks/obsidian";
import { clickLikeUser } from "./helpers/host-gestures";

const t = createTranslator("en");
const SOURCE = "| Name | Value |\n| --- | --- |\n| North | 1 |";
const editors: EditorView[] = [];

function editorState(initial = SOURCE) {
  let source = initial;
  let cm: EditorView | undefined;
  let writes = 0;
  const replaceRange = vi.fn((text: string, from: { ch: number }, to: { ch: number }) => {
    source = source.slice(0, from.ch) + text + source.slice(to.ch);
  });
  const editor = {
    getValue: () => cm?.state.doc.toString() ?? source,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    replaceRange,
    setCursor: vi.fn(),
  } as unknown as Editor;
  return {
    editor, replaceRange, source: () => cm?.state.doc.toString() ?? source, writes: () => writes,
    setSource: (next: string) => {
      source = next;
      cm?.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: next } });
    },
    attach: (parent: HTMLElement, file: TFile): EditorView => {
      cm = new EditorView({ parent, state: EditorState.create({ doc: source, extensions: [
        editorInfoField.init(() => ({ editor, file: file as unknown as HostFile, app: {} as App, hoverPopover: null })),
        EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; }),
      ] }) });
      editors.push(cm);
      return cm;
    },
  };
}

function fixture(doc = document, source = SOURCE) {
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
  const state = editorState(source);
  const containerEl = doc.body.appendChild(doc.createElement("div"));
  const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
    file, editor: state.editor, containerEl,
  });
  const cm = state.attach(containerEl, file);
  leaves.push({ view });
  const table = parseEditableTables(source).tables[0]!;
  return { app, file, files, leaves, state, view, table, containerEl, cm };
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
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); document.body.replaceChildren(); notices.length = 0; });

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
    expect(f.state.writes()).toBe(1);
    expect(parseEditableTables(f.state.source()).tables[0]?.rowHeaderColumnCount).toBe(1);
    expect(document.activeElement).toBe(f.cm.contentDOM);
  });

  it("restores focus to the captured editor in its own popout document", () => {
    const frame = document.body.appendChild(document.createElement("iframe"));
    const popup = frame.contentWindow!;
    const f = fixture(popup.document);
    const target = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view)!;
    requestWholeTableTranspose(f.app, t, f.table, target);
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Transpose anyway")!;
    clickLikeUser(confirm);
    expect(f.state.writes()).toBe(1);
    expect(popup.document.activeElement).toBe(f.cm.contentDOM);
  });

  it.each(["| --- |\n| one |", "| Name | Value |\n| --- | --- |"])("does not take focus for a no-op or refused transpose", (source) => {
    const f = fixture(document, source);
    const external = document.body.appendChild(document.createElement("button"));
    external.focus();
    const target = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view)!;
    target.apply();
    expect(f.state.writes()).toBe(0);
    expect(f.state.source()).toBe(source);
    expect(document.activeElement).toBe(external);
  });

  it("does not focus the captured editor when confirmation is canceled", () => {
    const f = fixture();
    const target = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view)!;
    const focus = vi.spyOn(f.cm, "focus");
    requestWholeTableTranspose(f.app, t, f.table, target);
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Cancel")!;
    clickLikeUser(cancel);
    expect(f.state.writes()).toBe(0);
    expect(focus).not.toHaveBeenCalled();
  });

  it("rejects a view rebound to another file even when its Markdown bytes and offset are identical", () => {
    const f = fixture();
    const original = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view)!;
    const external = document.body.appendChild(document.createElement("button"));
    external.focus();
    const b = new TFile("B.md");
    f.files.set("B.md", b);
    f.view.file = b as unknown as HostFile;
    expect(original.isCurrent()).toBe(false);
    original.apply();
    expect(f.state.source()).toBe(SOURCE);
    expect(f.state.replaceRange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(external);
  });

  it("requires a verified CodeMirror editor and ignores byte-identical embedded decoys", () => {
    const f = fixture();
    const decoy = editorState();
    const decoyParent = f.containerEl.insertBefore(document.createElement("div"), f.cm.dom);
    decoy.attach(decoyParent, f.file);
    const target = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view)!;
    expect(target).not.toBeNull();
    target.apply();
    expect(f.state.writes()).toBe(1);
    expect(decoy.writes()).toBe(0);
    f.cm.dom.remove();
    expect(captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view)).toBeNull();
  });

  it.each(["missing", "detached", "recreated", "wrong-editor"] as const)("refuses an unverified %s CodeMirror target", (change) => {
    const f = fixture();
    const target = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view)!;
    if (change === "missing") f.cm.destroy();
    else if (change === "detached") f.cm.dom.remove();
    else if (change === "recreated") { f.cm.destroy(); f.state.attach(f.containerEl, f.file); }
    else f.cm.setState(EditorState.create({ doc: SOURCE, extensions: [editorInfoField] }));
    expect(target.isCurrent()).toBe(false);
    target.apply();
    expect(f.state.writes()).toBe(0);
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
    const focus = vi.spyOn(f.cm, "focus");
    const target = captureEditorTransposeTarget(f.app, f.state.editor, f.table, t, f.view)!;
    expect(target.ownerDocument).toBe(popup.document);
    const draft = f.containerEl.appendChild(popup.document.createElement("textarea"));
    draft.className = "structural-tables-cell-editor";
    draft.value = "unfinished";
    requestWholeTableTranspose(f.app, t, f.table, target);
    expect(f.state.replaceRange).not.toHaveBeenCalled();
    expect(draft.value).toBe("unfinished");
    expect(notices[notices.length - 1]).toContain("active cell draft");
    expect(focus).not.toHaveBeenCalled();
  });

  it("refuses a stale file after opening a modal, before the confirmation click", () => {
    const f = fixture();
    const focus = vi.spyOn(f.cm, "focus");
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
    expect(focus).not.toHaveBeenCalled();
  });
});
