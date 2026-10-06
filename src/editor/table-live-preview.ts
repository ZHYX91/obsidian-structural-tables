import type { BaseEditorInfo } from "../app/base-promotion-service";
import {
  Prec, StateEffect, StateField,
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
import { structuralTableLogicalCursorSync, structuralTableSourceFocus } from "./table-source-focus";

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
          // Suppress the host/source rendering independently from the semantic
          // presentation widget. Markdown remains authoritative in EditorState,
          // while an exact-range replacement also wins over native table widgets.
          entries.push({
            from: table.range.from,
            to: table.range.to,
            decoration: Decoration.replace({ block: true }),
          });
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
      return Decoration.set(
        entries.map((entry) => entry.decoration.range(entry.from, entry.to)),
        true,
      );
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
        const historyFocus = transaction.effects.find((effect) => effect.is(tableHistoryTarget));
        const composing = composition?.value ?? value.composing;
        const sourceFocused = historyFocus?.value.restorePresentation === true
          ? historyFocus.value.after === ""
          : sourceFocus?.value ?? value.sourceFocused;
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
      private sourceFocusTimer: number | null = null;
      private readonly setSourceFocus = (focused: boolean): void => {
        const current = this.view.state.field(decorationField).sourceFocused;
        if (current !== focused) this.view.dispatch({ effects: structuralTableSourceFocus.of(focused) });
      };
      private readonly scheduleSourceFocus = (): void => {
        const win = this.view.dom.ownerDocument.defaultView;
        if (win === null) return;
        if (this.sourceFocusTimer !== null) win.clearTimeout(this.sourceFocusTimer);
        this.sourceFocusTimer = win.setTimeout(() => {
          this.sourceFocusTimer = null;
          if (!this.view.dom.isConnected) return;
          const active = this.view.dom.ownerDocument.activeElement;
          const sourceOwned = active !== null
            && this.view.contentDOM.contains(active)
            && active.closest(".structural-tables-live-preview") === null;
          // External controls do not end a source-editing session. Suppressing
          // its range on blur would make CodeMirror relocate the native caret
          // when focus returns. Only a visual-cell interaction yields ownership.
          if (sourceOwned) this.setSourceFocus(true);
        }, 0);
      };
      private readonly sourceFocusIn = (): void => this.scheduleSourceFocus();
      private readonly sourceFocusCapture = (event: FocusEvent): void => {
        const target = event.target;
        if (!(target instanceof this.view.dom.ownerDocument.defaultView!.Node)
          || !this.view.contentDOM.contains(target)) return;
        const element = target.nodeType === Node.ELEMENT_NODE ? target as Element : target.parentElement;
        if (element?.closest(".structural-tables-live-preview") !== null) return;
        // CodeMirror can relocate a caret whose range is currently replaced by
        // presentation decorations while focus is being restored. Reveal the
        // authoritative source synchronously in the capture phase, before the
        // host handles the focus transition.
        this.setSourceFocus(true);
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
            render: (table) => renderTableSignatures(app, table, sourcePath, this.view.dom.ownerDocument),
            owns: (table) => !value.composing && settings.enableLivePreview
              && Boolean(view.state.field(editorLivePreviewField, false))
              && table.valid && (table.structural || settings.takeOverOrdinaryTables),
            widget: (table) => new StructuralTableWidget(app, table, sourcePath, settings, settingsProvider, promote),
          };
        });
        views.add(view);
        view.dom.addEventListener("focusin", this.sourceFocusCapture, true);
        view.dom.addEventListener("focusin", this.sourceFocusIn);
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
        const externalSelectionChanged = update.transactions.some((transaction) =>
          transaction.selection !== undefined
          && !transaction.effects.some((effect) => effect.is(structuralTableLogicalCursorSync)));
        if (!externalSelectionChanged) return;
        for (const host of this.view.dom.querySelectorAll<HTMLElement>(".structural-tables-live-preview")) {
          clearTableWidgetSelection(host);
        }
      }

      destroy(): void {
        cancelPendingTableFocus(this.view);
        this.calloutTables.destroy();
        const win = this.view.dom.ownerDocument.defaultView;
        if (this.sourceFocusTimer !== null && win !== null) win.clearTimeout(this.sourceFocusTimer);
        this.sourceFocusTimer = null;
        this.view.dom.removeEventListener("focusin", this.sourceFocusCapture, true);
        this.view.dom.removeEventListener("focusin", this.sourceFocusIn);
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
