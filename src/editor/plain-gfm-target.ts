import type { App, Editor, MarkdownView } from "obsidian";
import type { PlainGfmTarget } from "../app/plain-gfm-modal";
import type { StructuralTable } from "../core/model";
import { withSourcePrefix } from "../core/source-lines";
import { plainGfmConversionInDocument } from "../core/plain-gfm-conversion";
import { captureEditorTableCommandTarget } from "./table-command-target";
import { editorTableDirection } from "./editor-view-context";

export function captureEditorPlainGfmTarget(app: App, editor: Editor, table: StructuralTable,
  viewHint?: MarkdownView, isActive?: () => boolean): PlainGfmTarget | null {
  const target = captureEditorTableCommandTarget(app, editor, table, viewHint, isActive);
  if (target === null) return null;
  return {
    sourcePath: target.sourcePath, ownerDocument: target.ownerDocument,
    draftRoot: target.draftRoot, isCurrent: target.isCurrent,
    readCurrentNote: () => target.isCurrent() ? editor.getValue() : null,
    direction: editorTableDirection(app, editor, table, viewHint),
    replace: (orientation, expectedPreview) => target.apply((source, current) => {
      const result = plainGfmConversionInDocument(source, current, orientation);
      return result.changed && expectedPreview !== undefined && result.source !== withSourcePrefix(expectedPreview, current.sourcePrefix)
        ? null : result;
    }),
  };
}
