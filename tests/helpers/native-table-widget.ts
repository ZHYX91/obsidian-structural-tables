import { EditorState } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { editorInfoField } from "obsidian";

import type { StructuralTable } from "../../src/core/model";

/** A native table must be a real mapped CM widget, including any cell editor. */
export class NativeTableWidget extends WidgetType {
  child: EditorView | null = null;
  constructor(private readonly table: StructuralTable, private readonly withChild = false) { super(); }

  override toDOM(view: EditorView): HTMLElement {
    const host = view.dom.ownerDocument.createElement("div"); host.className = "cm-table-widget";
    const table = host.appendChild(view.dom.ownerDocument.createElement("table"));
    for (const [rowIndex, row] of this.table.rows.entries()) {
      const section = rowIndex < this.table.headerRowCount ? table.tHead ?? table.createTHead() : table.tBodies[0] ?? table.createTBody();
      const tr = section.insertRow();
      for (const [column, cell] of row.cells.entries()) {
        const td = tr.appendChild(view.dom.ownerDocument.createElement(rowIndex < this.table.headerRowCount ? "th" : "td"));
        if (this.withChild && rowIndex === this.table.headerRowCount && column === 0) {
          this.child = new EditorView({ parent: td, state: EditorState.create({ doc: cell.content,
            extensions: [editorInfoField.init(() => view.state.field(editorInfoField))],
          }) });
        } else td.textContent = cell.content;
      }
    }
    return host;
  }

  override destroy(): void { this.child?.destroy(); this.child = null; }
}
