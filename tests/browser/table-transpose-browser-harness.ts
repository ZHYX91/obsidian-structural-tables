import { MarkdownView, type App, type Editor, type TFile as HostFile } from "obsidian";

import { requestWholeTableTranspose } from "../../src/app/table-transpose-modal";
import { createTranslator } from "../../src/config/i18n";
import { parseEditableTables } from "../../src/core/parser";
import { captureEditorTransposeTarget } from "../../src/editor/table-transpose-target";
import { notices, TFile } from "../mocks/obsidian";

HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K, options?: { text?: string },
): HTMLElementTagNameMap[K] {
  const node = this.ownerDocument.createElement(tag);
  if (options?.text !== undefined) node.textContent = options.text;
  this.appendChild(node);
  return node;
};
HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };

const original = "| Name | Value |\n| --- | --- |\n| North | 1 |";
let source = original;
let changes = 0;
let pointers = 0;
let currentView: MarkdownView | null = null;
let files: Map<string, TFile> = new Map();
let app: App;
const t = createTranslator("en");
document.addEventListener("pointerdown", () => { pointers += 1; }, { capture: true });

function reset(mode: "normal" | "stale" | "popout-draft"): void {
  document.body.replaceChildren();
  notices.length = 0;
  source = original;
  changes = 0;
  pointers = 0;
  files = new Map();
  const file = new TFile("A.md");
  files.set(file.path, file);
  const editor = {
    getValue: () => source,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    replaceRange: (value: string, from: { ch: number }, to: { ch: number }) => {
      source = source.slice(0, from.ch) + value + source.slice(to.ch);
      changes += 1;
    },
    setCursor: () => undefined,
  } as unknown as Editor;
  const frame = mode === "popout-draft" ? document.body.appendChild(document.createElement("iframe")) : null;
  const doc = frame?.contentWindow?.document ?? document;
  const containerEl = doc.body.appendChild(doc.createElement("div"));
  currentView = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
    containerEl, editor, file: file as unknown as HostFile,
  });
  app = {
    vault: { getFileByPath: (path: string) => files.get(path) ?? null },
    workspace: {
      containerEl: document.body,
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => {
        if (currentView !== null) callback({ view: currentView });
      },
    },
  } as unknown as App;
  const parsed = parseEditableTables(original).tables[0]!;
  const request = captureEditorTransposeTarget(app, editor, parsed, t, currentView);
  if (request === null) throw new Error("Capture failed");
  if (mode === "popout-draft") {
    const draft = containerEl.appendChild(doc.createElement("textarea"));
    draft.className = "structural-tables-cell-editor";
    draft.value = "unsaved";
  }
  requestWholeTableTranspose(app, t, parsed, request);
}

function switchFile(): void {
  const file = new TFile("B.md");
  files.set(file.path, file);
  if (currentView !== null) currentView.file = file as unknown as HostFile;
}

function result() {
  return {
    source, changes, pointers,
    rowHeaders: parseEditableTables(source).tables[0]?.rowHeaderColumnCount ?? -1,
    confirmationVisible: [...document.querySelectorAll("button")]
      .some((button) => button.textContent === "Transpose anyway"),
    notices: [...notices],
  };
}

(window as typeof window & { transposeBrowser?: unknown }).transposeBrowser = { reset, switchFile, result };
