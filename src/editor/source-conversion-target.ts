import { isolateHistory } from "@codemirror/commands";
import type { App, Editor, TFile } from "obsidian";
import type { SourceRange } from "../core/model";
import { attachedEditorContext } from "./editor-view-context";

/** Bind a preview to one complete-note editor and isolate its single replacement. */
export function captureSourceConversionTarget(app: App, editor: Editor, file: TFile | null,
  isActive: () => boolean) {
  const context = attachedEditorContext(app, editor);
  if (context === null || context.file !== file) return null;
  const document = context.view.state.doc;
  const isCurrent = (): boolean => isActive() && context.isCurrent()
    && context.view.state.doc === document
    && context.markdown.containerEl.querySelector("textarea.structural-tables-cell-editor") === null;
  return {
    isCurrent,
    replace: (range: SourceRange, source: string): boolean => {
      if (!isCurrent() || range.from < 0 || range.to < range.from || range.to > document.length) return false;
      context.view.dispatch({
        changes: { from: range.from, to: range.to, insert: source },
        selection: { anchor: range.from + source.length },
        annotations: isolateHistory.of("full"),
      });
      context.view.focus();
      return true;
    },
  };
}
