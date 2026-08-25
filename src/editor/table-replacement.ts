import type { Editor, EditorPosition } from "obsidian";

import type { StructuralTable } from "../core/model";

export function positionAfterReplacement(from: EditorPosition, replacement: string): EditorPosition {
  const lines = replacement.split(/\r\n|\r|\n/u);
  const finalLine = lines[lines.length - 1] ?? "";
  if (lines.length === 1) return { line: from.line, ch: from.ch + finalLine.length };
  return { line: from.line + lines.length - 1, ch: finalLine.length };
}

export function replaceTableSource(editor: Editor, table: StructuralTable, source: string): void {
  const from = editor.offsetToPos(table.range.from);
  const to = editor.offsetToPos(table.range.to);
  editor.replaceRange(source, from, to);
  editor.setCursor(positionAfterReplacement(from, source));
}
