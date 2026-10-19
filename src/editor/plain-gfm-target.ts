import type { App, Editor, MarkdownView } from "obsidian";
import type { PlainGfmTarget } from "../app/plain-gfm-modal";
import type { StructuralTable } from "../core/model";
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
    direction: editorTableDirection(app, editor, table, viewHint),
    replace: (orientation) => target.apply((source, current) => plainGfmConversionInDocument(source, current, orientation)),
  };
}
