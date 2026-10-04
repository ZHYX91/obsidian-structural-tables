import type { BaseEditorInfo } from "../app/base-promotion-service";
import {
  Prec, RangeSetBuilder, StateEffect, StateField,
  type EditorState, type Extension, type Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { App, editorInfoField, editorLivePreviewField, type Editor } from "obsidian";

import { createTranslator, diagnosticNotice } from "../config/i18n";
import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { parseEditableTables } from "../core/parser";
import { cancelPendingTableFocus, clearTableWidgetSelection, mapPendingTableFocus, restoreTableHistoryFocus, StructuralTableWidget } from "./table-widget";
import { tableHistory, tableHistoryTarget } from "./table-history";
import { mapTablesThroughProseEdit } from "./table-parse-cache";
import { calloutRanges } from "../core/source-lines";
import { CalloutTables } from "./callout-tables";
import { renderTableSignatures } from "../rendering/native-table-mapping";
import { structuralTableViewMode } from "./table-view-state";

export const refreshStructuralTables = StateEffect.define<void>();

interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
}

interface StructuralTableDecorationState {
  callouts: readonly { from: number; to: number }[];
  composing: boolean;
  sourceFocused: boolean;
  tables: readonly StructuralTable[] | null;
  decorations: DecorationSet;
}

const structuralTableComposition = StateEffect.define<boolean>();
const structuralTableSourceFocus = StateEffect.define<boolean>();

export class StructuralTableEditorController {
  private readonly views = new Set<EditorView>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => StructuralTablesSettings,
    private readonly promote?: (editor: Editor, getInfo: BaseEditorInfo, table: StructuralTable) => void,
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
    const buildDecorations = (
      state: EditorState,
      tables: readonly StructuralTable[] | null,
      callouts: readonly { from: number; to: number }[],
      sourceFocused: boolean,
    ): DecorationSet => {
      const settings = settingsProvider();
      const livePreview = state.field(editorLivePreviewField, false) ?? false;
      if (!livePreview || !settings.enableLivePreview) return Decoration.none;
      const sourcePath = state.field(editorInfoField, false)?.file?.path ?? "";
      const selections = state.selection.ranges;
      const entries: DecorationEntry[] = [];
      for (const table of tables ?? []) {
        const mode = structuralTableViewMode(table, settings, selections, callouts, sourceFocused);
        if (mode === "ignored" || mode === "source") continue;
        if (mode === "presentation") {
          entries.push({
            from: table.range.from,
            to: table.range.from,
            decoration: Decoration.widget({
              widget: new StructuralTableWidget(app, table, sourcePath, settings, settingsProvider, promote),
              block: true,
              side: -1,
            }),
          });
          const firstLine = state.doc.lineAt(table.range.from).number;
          const lastLine = state.doc.lineAt(Math.max(table.range.from, table.range.to - 1)).number;
          for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
            const line = state.doc.line(lineNumber);
            entries.push({
              from: line.from,
              to: line.from,
              decoration: Decoration.line({
                attributes: {
                  class: "structural-tables-source-hidden",
                  "aria-hidden": "true",
                },
              }),
            });
          }
        } else if (settings.showDiagnostics) {
          const line = state.doc.lineAt(table.range.from);
          entries.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({
              attributes: {
                class: "structural-tables-invalid",
                title: table.diagnostics.map((diagnostic) =>
                  diagnosticNotice(createTranslator(settings.language), diagnostic)).join(" "),
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
      const sourceFocusChanged = transaction.effects.some((effect) => effect.is(structuralTableSourceFocus));
      const modeChanged = transaction.startState.field(editorLivePreviewField, false)
        !== transaction.state.field(editorLivePreviewField, false);
      return transaction.docChanged || transaction.selection !== undefined || refreshed
        || compositionChanged || sourceFocusChanged || modeChanged;
    };
    const decorationField = StateField.define<StructuralTableDecorationState>({
      create: (state) => {
        const tables = readTables(state, null);
        const callouts = calloutRanges(state.doc.toString());
        const sourceFocused = true;
        return {
          composing: false,
          sourceFocused,
          tables,
          callouts,
          decorations: buildDecorations(state, tables, callouts, sourceFocused),
        };
      },
      update: (value, transaction) => {
        const composition = transaction.effects.find((effect) => effect.is(structuralTableComposition));
        const sourceFocus = transaction.effects.find((effect) => effect.is(structuralTableSourceFocus));
        const composing = composition?.value ?? value.composing;
        const sourceFocused = sourceFocus?.value ?? value.sourceFocused;
        if (!shouldRebuild(transaction)) return value;
        const mapped = transaction.docChanged ? mapTablesThroughProseEdit(value.tables, transaction) : value.tables;
        const tables = readTables(transaction.state, mapped);
        const callouts = !transaction.docChanged ? value.callouts : mapped === null
          ? calloutRanges(transaction.state.doc.toString())
          : value.callouts.map((range) => ({ from: transaction.changes.mapPos(range.from, 1), to: transaction.changes.mapPos(range.to, -1) }));
        return {
          composing,
          sourceFocused,
          tables,
          callouts,
          decorations: composing
            ? Decoration.none
            : buildDecorations(transaction.state, tables, callouts, sourceFocused),
        };
      },
      provide: (field) => Prec.highest(EditorView.decorations.from(field, (value) => value.decorations)),
    });
    const viewTracker = ViewPlugin.fromClass(class {
      private readonly calloutTables: CalloutTables;
      private readonly updateSourceFocus = (): void => {
        const focused = this.view.dom.ownerDocument.activeElement === this.view.contentDOM;
        const current = this.view.state.field(decorationField).sourceFocused;
        if (current !== focused) this.view.dispatch({ effects: structuralTableSourceFocus.of(focused) });
      };
      private readonly sourceFocusIn = (): void => {
        const current = this.view.state.field(decorationField).sourceFocused;
        if (!current) this.view.dispatch({ effects: structuralTableSourceFocus.of(true) });
      };
      private readonly sourceFocusOut = (): void => {
        queueMicrotask(this.updateSourceFocus);
      };
      private readonly clearOtherSelections = (event: Event): void => {
        cancelPendingTableFocus(this.view);
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
            tables: value.tables ?? [], ranges: value.callouts, sourcePath,
            render: (table) => renderTableSignatures(app, table, sourcePath),
            owns: (table) => !value.composing && settings.enableLivePreview
              && Boolean(view.state.field(editorLivePreviewField, false))
              && table.valid && (table.structural || settings.takeOverOrdinaryTables),
            widget: (table) => new StructuralTableWidget(app, table, sourcePath, settings, settingsProvider, promote),
          };
        });
        views.add(view);
        view.contentDOM.addEventListener("focus", this.sourceFocusIn);
        view.contentDOM.addEventListener("blur", this.sourceFocusOut);
        view.dom.addEventListener("pointerdown", this.clearOtherSelections, true);
        view.dom.addEventListener("focusin", this.clearOtherSelections, true);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) {
          this.calloutTables.mapChanges(update.changes);
          mapPendingTableFocus(update.view, update.changes);
        }
        for (const transaction of update.transactions) {
          if (!settingsProvider().enableLivePreview || !this.view.state.field(editorLivePreviewField, false)) continue;
          if (!transaction.isUserEvent("undo") && !transaction.isUserEvent("redo")) continue;
          for (const effect of transaction.effects) {
            if (effect.is(tableHistoryTarget)) restoreTableHistoryFocus(this.view, effect.value, settingsProvider());
          }
        }
        this.calloutTables.schedule();
        if (!update.transactions.some((transaction) => transaction.selection !== undefined)) return;
        for (const host of this.view.dom.querySelectorAll<HTMLElement>(".structural-tables-live-preview")) {
          clearTableWidgetSelection(host);
        }
      }

      destroy(): void {
        cancelPendingTableFocus(this.view);
        this.calloutTables.destroy();
        this.view.contentDOM.removeEventListener("focus", this.sourceFocusIn);
        this.view.contentDOM.removeEventListener("blur", this.sourceFocusOut);
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
    return [decorationField, viewTracker, compositionHandlers, tableHistory];
  }

  refresh(): void {
    for (const view of this.views) view.dispatch({ effects: refreshStructuralTables.of(undefined) });
  }
}
