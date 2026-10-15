import { EditorState } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { editorInfoField } from "obsidian";

/** Native cell editors inherit the note editor/file info but own a smaller doc. */
export class NativeCellEditorWidget extends WidgetType {
  child: EditorView | null = null;
  constructor(private readonly source: string, private readonly direction: "ltr" | "rtl" = "ltr") { super(); }

  override toDOM(view: EditorView): HTMLElement {
    const host = view.dom.ownerDocument.createElement("div"); host.className = "cm-table-widget";
    const table = host.appendChild(view.dom.ownerDocument.createElement("table")); table.style.direction = this.direction;
    const info = view.state.field(editorInfoField);
    this.child = new EditorView({ parent: table.createTBody().insertRow().insertCell(), state: EditorState.create({
      doc: this.source, extensions: [editorInfoField.init(() => info)],
    }) });
    this.child.contentDOM.style.direction = this.direction;
    return host;
  }

  override destroy(): void { this.child?.destroy(); this.child = null; }
}
