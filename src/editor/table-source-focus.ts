import { StateEffect } from "@codemirror/state";

/**
 * Tracks whether the native CodeMirror source surface owns editing focus.
 * Widget interactions explicitly clear this before synchronizing a logical cursor.
 */
export const structuralTableSourceFocus = StateEffect.define<boolean>();

/** Marks visual-cell cursor synchronization so it does not clear widget-owned selection. */
export const structuralTableLogicalCursorSync = StateEffect.define<void>();

/** A validated visual-cell blur commit may precede touch's native source selection. */
export const structuralTableCellBlurCommit = StateEffect.define<{ from: number; before: string; after: string; sourcePath: string }>();
