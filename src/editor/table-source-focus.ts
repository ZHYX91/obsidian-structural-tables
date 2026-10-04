import { StateEffect } from "@codemirror/state";

/**
 * Tracks whether the native CodeMirror source surface owns editing focus.
 * Widget interactions explicitly clear this before synchronizing a logical cursor.
 */
export const structuralTableSourceFocus = StateEffect.define<boolean>();

/** Marks visual-cell cursor synchronization so it does not clear widget-owned selection. */
export const structuralTableLogicalCursorSync = StateEffect.define<void>();
