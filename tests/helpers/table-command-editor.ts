import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { App, MarkdownView, editorInfoField, editorLivePreviewField, type Editor, type TFile as HostFile } from "obsidian";
import { TFile } from "../mocks/obsidian";

/** A real note editor, attached Markdown view and file map for command/menu tests. */
export function tableCommandEditor(source: string, extension: Extension = [], owner = document) {
  const files = new Map<string, TFile>();
  const leaves: { view: MarkdownView }[] = [];
  const file = new TFile("Notes/table.md");
  files.set(file.path, file);
  let writes = 0;
  let cm: EditorView;
  const toOffset = ({ line, ch }: { line: number; ch: number }) => cm.state.doc.line(line + 1).from + ch;
  const editor = {
    getValue: () => cm.state.doc.toString(),
    getCursor: () => { const line = cm.state.doc.lineAt(cm.state.selection.main.head); return { line: line.number - 1, ch: cm.state.selection.main.head - line.from }; },
    getLine: (line: number) => cm.state.doc.line(line + 1).text,
    posToOffset: toOffset,
    offsetToPos: (offset: number) => { const line = cm.state.doc.lineAt(offset); return { line: line.number - 1, ch: offset - line.from }; },
    setCursor: (position: { line: number; ch: number }) => cm.dispatch({ selection: { anchor: toOffset(position) } }),
    replaceRange: (insert: string, from: { line: number; ch: number }, to: { line: number; ch: number }) => cm.dispatch({ changes: { from: toOffset(from), to: toOffset(to), insert } }),
  } as unknown as Editor;
  const app = Object.assign(new App(), {
    vault: {
      getFileByPath: (path: string) => files.get(path) ?? null,
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: async () => cm.state.doc.toString(),
    },
    workspace: {
      containerEl: owner.body,
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => leaves.forEach(callback),
      on: () => ({}),
    },
  });
  const containerEl = owner.body.appendChild(owner.createElement("div"));
  containerEl.className = "markdown-source-view";
  const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { file, editor, containerEl });
  leaves.push({ view });
  cm = new EditorView({ parent: containerEl, state: EditorState.create({ doc: source, extensions: [
    history(), editorLivePreviewField,
    editorInfoField.init(() => ({ file: file as unknown as HostFile, editor, app, hoverPopover: null })),
    EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; }),
    extension,
  ] }) });
  return { app, cm, editor, file, files, leaves, view, containerEl, writes: () => writes,
    source: () => cm.state.doc.toString(), destroy: () => { cm.destroy(); containerEl.remove(); } };
}
