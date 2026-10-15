import { StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Tracks whether the native CodeMirror source surface owns editing focus.
 * Widget interactions explicitly clear this before synchronizing a logical cursor.
 */
export const structuralTableSourceFocus = StateEffect.define<boolean>();

/** Marks visual-cell cursor synchronization so it does not clear widget-owned selection. */
export const structuralTableLogicalCursorSync = StateEffect.define<void>();

/** A validated visual-cell blur commit may precede touch's native source selection. */
export interface CellBlurCommit { from: number; before: string; after: string; sourcePath: string; height: number; minHeight: number }
export const structuralTableCellBlurCommit = StateEffect.define<CellBlurCommit>();

const pendingSourcePointers = new WeakSet<EditorView>();
export function setTableSourcePointerPending(view: EditorView, pending: boolean): void {
  if (pending) pendingSourcePointers.add(view); else pendingSourcePointers.delete(view);
}
export function tableSourcePointerPending(view: EditorView): boolean { return pendingSourcePointers.has(view); }
