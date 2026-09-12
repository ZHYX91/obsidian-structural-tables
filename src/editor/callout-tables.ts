import type { EditorView } from "@codemirror/view";
import type { StructuralTable } from "../core/model";
import { rawStructuralTableElement } from "../reading/table-mapping";
import type { StructuralTableWidget } from "./table-widget";

interface MountedTable {
  original: HTMLElement;
  host: HTMLElement;
  widget: StructuralTableWidget;
  table: StructuralTable;
}

/** Native callouts own a whole CodeMirror block; mount the shared cell UI inside it. */
export class CalloutTables {
  private readonly mounted = new Map<HTMLElement, MountedTable>();
  private readonly observer: MutationObserver;
  private scheduled = false;
  private disposed = false;

  constructor(
    private readonly view: EditorView,
    private readonly read: () => {
      tables: readonly StructuralTable[];
      ranges: readonly { from: number; to: number }[];
      owns: (table: StructuralTable) => boolean;
      widget: (table: StructuralTable) => StructuralTableWidget;
    },
  ) {
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(view.dom, { childList: true, subtree: true });
    this.schedule();
  }

  schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.disposed) this.refresh();
    });
  }

  private refresh(): void {
    const state = this.read();
    for (const [host, entry] of this.mounted) {
      const table = state.tables.find((candidate) => candidate.sourceTableIndex === entry.table.sourceTableIndex);
      const widget = table === undefined ? null : state.widget(table);
      if (host.isConnected && table !== undefined && state.owns(table) && widget?.updateDOM(host)) {
        entry.table = table;
        entry.widget = widget;
        continue;
      }
      entry.widget.destroy(host);
      if (host.parentElement !== null) host.replaceWith(entry.original);
      this.mounted.delete(host);
    }
    for (const callout of this.view.dom.querySelectorAll<HTMLElement>(".callout")) {
      if (callout.parentElement?.closest(".callout") !== null) continue;
      let position: number;
      try { position = this.view.posAtDOM(callout); } catch { continue; }
      const range = state.ranges.find((candidate) => position >= candidate.from && position <= candidate.to);
      if (range === undefined) continue;
      const tables = state.tables.filter((table) => table.range.from >= range.from && table.range.to <= range.to);
      const native = Array.from(callout.querySelectorAll<HTMLTableElement>("table"))
        .filter((table) => !table.closest(".structural-tables-live-preview"));
      let nativeIndex = 0;
      for (const table of tables) {
        if ([...this.mounted.values()].some((entry) => callout.contains(entry.host)
          && entry.table.range.from === table.range.from)) continue;
        const raw = rawStructuralTableElement(callout, table);
        const original = raw ?? (table.rowHeaderColumnCount === 0 ? native[nativeIndex++] : undefined);
        if (original === undefined || !state.owns(table)) continue;
        const widget = state.widget(table);
        const host = widget.toDOM(this.view);
        original.replaceWith(host);
        this.mounted.set(host, { original, host, widget, table });
      }
    }
  }

  destroy(): void {
    this.disposed = true;
    this.observer.disconnect();
    for (const entry of this.mounted.values()) {
      entry.widget.destroy(entry.host);
      if (entry.host.parentElement !== null) entry.host.replaceWith(entry.original);
    }
    this.mounted.clear();
  }
}
