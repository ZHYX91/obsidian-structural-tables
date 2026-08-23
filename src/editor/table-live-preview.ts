import { RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { App, Component, editorInfoField, editorLivePreviewField } from "obsidian";

import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { parseStructuralTables } from "../core/parser";
import { diagnosticText, renderStructuralTable } from "../rendering/table-renderer";

export const refreshStructuralTables = StateEffect.define<void>();

class StructuralTableWidget extends WidgetType {
  private component: Component | null = null;

  constructor(
    private readonly app: App,
    private readonly table: StructuralTable,
    private readonly sourcePath: string,
    private readonly settings: StructuralTablesSettings,
  ) {
    super();
  }

  override eq(other: StructuralTableWidget): boolean {
    return this.table.source === other.table.source
      && this.sourcePath === other.sourcePath
      && this.settings.density === other.settings.density
      && this.settings.layout === other.settings.layout
      && this.settings.zebraRows === other.settings.zebraRows;
  }

  override toDOM(view: EditorView): HTMLElement {
    this.component = new Component();
    this.component.load();
    const host = view.dom.ownerDocument.createElement("div");
    host.className = "structural-tables-live-preview";
    host.dataset.layout = this.settings.layout;
    host.dataset.density = this.settings.density;
    host.dataset.zebra = String(this.settings.zebraRows);
    renderStructuralTable(this.app, this.table, host, this.sourcePath, this.component);
    return host;
  }

  override destroy(): void {
    this.component?.unload();
    this.component = null;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
}

export class StructuralTableEditorController {
  private readonly views = new Set<EditorView>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => StructuralTablesSettings,
  ) {}

  createExtension(): Extension {
    const app = this.app;
    const settingsProvider = this.getSettings;
    const views = this.views;
    return ViewPlugin.fromClass(class {
      decorations: DecorationSet;

      constructor(private readonly view: EditorView) {
        views.add(view);
        this.decorations = this.build();
      }

      update(update: ViewUpdate): void {
        const refreshed = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshStructuralTables)));
        const modeChanged = update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false);
        if (update.docChanged || update.selectionSet || refreshed || modeChanged) this.decorations = this.build();
      }

      destroy(): void {
        views.delete(this.view);
      }

      private build(): DecorationSet {
        const settings = settingsProvider();
        const livePreview = this.view.state.field(editorLivePreviewField, false) ?? false;
        if (!livePreview || !settings.enableLivePreview || this.view.composing) return Decoration.none;
        const source = this.view.state.doc.toString();
        const sourcePath = this.view.state.field(editorInfoField, false)?.file?.path ?? "";
        const selections = this.view.state.selection.ranges;
        const entries: DecorationEntry[] = [];
        for (const table of parseStructuralTables(source).tables) {
          const active = selections.some((selection) => selection.from <= table.range.to && selection.to >= table.range.from);
          if (active) continue;
          if (table.valid) {
            entries.push({
              from: table.range.from,
              to: table.range.to,
              decoration: Decoration.replace({
                widget: new StructuralTableWidget(app, table, sourcePath, settings),
                block: true,
                inclusive: false,
              }),
            });
          } else if (settings.showDiagnostics) {
            const line = this.view.state.doc.lineAt(table.range.from);
            entries.push({
              from: line.from,
              to: line.from,
              decoration: Decoration.line({
                attributes: {
                  class: "structural-tables-invalid",
                  title: diagnosticText(table),
                },
              }),
            });
          }
        }
        entries.sort((left, right) => left.from - right.from || left.to - right.to);
        const builder = new RangeSetBuilder<Decoration>();
        for (const entry of entries) builder.add(entry.from, entry.to, entry.decoration);
        return builder.finish();
      }
    }, { decorations: (instance) => instance.decorations });
  }

  refresh(): void {
    for (const view of this.views) view.dispatch({ effects: refreshStructuralTables.of(undefined) });
  }
}
