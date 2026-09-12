import {
  Prec, RangeSetBuilder, StateEffect, StateField,
  type EditorState, type Extension, type Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { App, editorInfoField, editorLivePreviewField, type Editor, type TFile } from "obsidian";

import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { parseEditableTables } from "../core/parser";
import { diagnosticText } from "../rendering/table-renderer";
import { clearTableWidgetSelection, StructuralTableWidget } from "./table-widget";
import { mapTablesThroughProseEdit } from "./table-parse-cache";
import { calloutRanges } from "../core/source-lines";
import { CalloutTables } from "./callout-tables";

export const refreshStructuralTables = StateEffect.define<void>();

interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
}

interface StructuralTableDecorationState {
  callouts: readonly { from: number; to: number }[];
  composing: boolean;
  tables: readonly StructuralTable[] | null;
  decorations: DecorationSet;
}

const structuralTableComposition = StateEffect.define<boolean>();

export class StructuralTableEditorController {
  private readonly views = new Set<EditorView>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => StructuralTablesSettings,
    private readonly promote?: (editor: Editor, sourceFile: TFile | null, table: StructuralTable) => void,
  ) {}

  createExtension(): Extension {
    const app = this.app;
    const settingsProvider = this.getSettings;
    const promote = this.promote;
    const views = this.views;
    const readTables = (state: EditorState, cached: readonly StructuralTable[] | null): readonly StructuralTable[] | null => {
      if (!settingsProvider().enableLivePreview || !state.field(editorLivePreviewField, false)) return null;
      return cached ?? parseEditableTables(state.doc.toString()).tables;
    };
    const buildDecorations = (state: EditorState, tables: readonly StructuralTable[] | null, callouts: readonly { from: number; to: number }[]): DecorationSet => {
      const settings = settingsProvider();
      const livePreview = state.field(editorLivePreviewField, false) ?? false;
      if (!livePreview || !settings.enableLivePreview) return Decoration.none;
      const sourcePath = state.field(editorInfoField, false)?.file?.path ?? "";
      const selections = state.selection.ranges;
      const entries: DecorationEntry[] = [];
      for (const table of tables ?? []) {
        if (callouts.some((range) => table.range.from >= range.from && table.range.to <= range.to)) continue;
        if (!table.structural && !settings.takeOverOrdinaryTables) continue;
        const active = selections.some((selection) => selection.empty
          ? selection.from >= table.range.from && selection.from < table.range.to
          : selection.from < table.range.to && selection.to > table.range.from);
        if (active) continue;
        if (table.valid) {
          entries.push({
            from: table.range.from,
            to: table.range.to,
            decoration: Decoration.replace({
              widget: new StructuralTableWidget(app, table, sourcePath, settings, settingsProvider, promote),
              block: true,
            }),
          });
        } else if (settings.showDiagnostics) {
          const line = state.doc.lineAt(table.range.from);
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
    };
    const shouldRebuild = (transaction: Transaction): boolean => {
      const refreshed = transaction.effects.some((effect) => effect.is(refreshStructuralTables));
      const compositionChanged = transaction.effects.some((effect) => effect.is(structuralTableComposition));
      const modeChanged = transaction.startState.field(editorLivePreviewField, false)
        !== transaction.state.field(editorLivePreviewField, false);
      return transaction.docChanged || transaction.selection !== undefined || refreshed || compositionChanged || modeChanged;
    };
    const decorationField = StateField.define<StructuralTableDecorationState>({
      create: (state) => {
        const tables = readTables(state, null);
        const callouts = calloutRanges(state.doc.toString());
        return { composing: false, tables, callouts, decorations: buildDecorations(state, tables, callouts) };
      },
      update: (value, transaction) => {
        const composition = transaction.effects.find((effect) => effect.is(structuralTableComposition));
        const composing = composition?.value ?? value.composing;
        if (!shouldRebuild(transaction)) return value;
        const mapped = transaction.docChanged ? mapTablesThroughProseEdit(value.tables, transaction) : value.tables;
        const tables = readTables(transaction.state, mapped);
        const callouts = !transaction.docChanged ? value.callouts : mapped === null
          ? calloutRanges(transaction.state.doc.toString())
          : value.callouts.map((range) => ({ from: transaction.changes.mapPos(range.from, 1), to: transaction.changes.mapPos(range.to, -1) }));
        return {
          composing,
          tables,
          callouts,
          decorations: composing ? Decoration.none : buildDecorations(transaction.state, tables, callouts),
        };
      },
      provide: (field) => Prec.highest(EditorView.decorations.from(field, (value) => value.decorations)),
    });
    const viewTracker = ViewPlugin.fromClass(class {
      private readonly calloutTables: CalloutTables;
      private readonly clearOtherSelections = (event: Event): void => {
        const target = event.target;
        for (const host of this.view.dom.querySelectorAll<HTMLElement>(".structural-tables-live-preview")) {
          if (target !== null && target instanceof host.ownerDocument.defaultView!.Node && host.contains(target)) continue;
          clearTableWidgetSelection(host);
        }
      };

      constructor(private readonly view: EditorView) {
        this.calloutTables = new CalloutTables(view, () => {
          const value = view.state.field(decorationField);
          const settings = settingsProvider();
          const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? "";
          return {
            tables: value.tables ?? [], ranges: value.callouts,
            owns: (table) => !value.composing && settings.enableLivePreview
              && Boolean(view.state.field(editorLivePreviewField, false))
              && table.valid && (table.structural || settings.takeOverOrdinaryTables),
            widget: (table) => new StructuralTableWidget(app, table, sourcePath, settings, settingsProvider, promote),
          };
        });
        views.add(view);
        view.dom.addEventListener("pointerdown", this.clearOtherSelections, true);
        view.dom.addEventListener("focusin", this.clearOtherSelections, true);
      }

      update(update: ViewUpdate): void {
        this.calloutTables.schedule();
        if (!update.transactions.some((transaction) => transaction.selection !== undefined)) return;
        for (const host of this.view.dom.querySelectorAll<HTMLElement>(".structural-tables-live-preview")) {
          clearTableWidgetSelection(host);
        }
      }

      destroy(): void {
        this.calloutTables.destroy();
        this.view.dom.removeEventListener("pointerdown", this.clearOtherSelections, true);
        this.view.dom.removeEventListener("focusin", this.clearOtherSelections, true);
        views.delete(this.view);
      }
    });
    const compositionHandlers = EditorView.domEventHandlers({
      compositionstart: (_event, view) => {
        view.dispatch({ effects: structuralTableComposition.of(true) });
        return false;
      },
      compositionend: (_event, view) => {
        view.dispatch({ effects: structuralTableComposition.of(false) });
        return false;
      },
    });
    return [decorationField, viewTracker, compositionHandlers];
  }

  refresh(): void {
    for (const view of this.views) view.dispatch({ effects: refreshStructuralTables.of(undefined) });
  }
}
