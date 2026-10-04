import { StateEffect } from "@codemirror/state";

/**
 * Tracks whether the native CodeMirror source surface owns editing focus.
 * Widget interactions explicitly clear this before synchronizing a logical cursor.
 */
export const structuralTableSourceFocus = StateEffect.define<boolean>();
