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
import { structuralTableCellBlurCommit, structuralTableLogicalCursorSync, structuralTableSourceFocus } from "./table-source-focus";
import type { ExportTableImage } from "../app/table-image-modal";

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

function isCellBlurCommit(transaction: Transaction): boolean {
  const commit = transaction.effects.find((effect) => effect.is(structuralTableCellBlurCommit))?.value;
  if (commit === undefined || transaction.startState.field(editorInfoField, false)?.file?.path !== commit.sourcePath
    || transaction.state.field(editorInfoField, false)?.file?.path !== commit.sourcePath
    || transaction.startState.doc.sliceString(commit.from, commit.from + commit.before.length) !== commit.before) return false;
  let count = 0; let matches = false;
  transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    count += 1; matches = from === commit.from && to === from + commit.before.length && inserted.toString() === commit.after;
  });
  return count === 1 && matches;
}

export class StructuralTableEditorController {
  private readonly views = new Set<EditorView>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => StructuralTablesSettings,
    private readonly promote?: (editor: Editor, getInfo: BaseEditorInfo, table: StructuralTable) => void,
    private readonly exportImage?: ExportTableImage,
  ) {}

  createExtension(): Extension {
    const app = this.app;
    const settingsProvider = this.getSettings;
    const promote = this.promote;
    const exportImage = this.exportImage;
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
      restoredTarget?: { from: number; source: string; sourcePath: string },
    ): DecorationSet => {
      const settings = settingsProvider();
      const livePreview = state.field(editorLivePreviewField, false) ?? false;
      if (!livePreview || !settings.enableLivePreview) return Decoration.none;
      const sourcePath = state.field(editorInfoField, false)?.file?.path ?? "";
      const selections = state.selection.ranges;
      const entries: DecorationEntry[] = [];
      for (const table of tables ?? []) {
        const resolvedMode = structuralTableViewMode(table, settings, selections, callouts, sourceFocused);
        const restored = restoredTarget !== undefined
          && sourcePath === restoredTarget.sourcePath
          && table.range.from === restoredTarget.from
          && table.source === restoredTarget.source;
        const mode = restored && resolvedMode !== "ignored"
          ? table.valid ? "presentation" : "invalid"
          : resolvedMode;
        if (mode === "ignored" || mode === "source") continue;
        if (mode === "presentation") {
          entries.push({
            from: table.range.from,
            to: table.range.from,
            decoration: Decoration.widget({
              widget: new StructuralTableWidget(app, table, sourcePath, settings, settingsProvider, promote, exportImage),
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
        const sourceFocused = sourceFocus?.value ?? value.sourceFocused;
        const restoredTarget = historyFocus?.value.restorePresentation === true
          && historyFocus.value.after !== ""
          ? {
            from: historyFocus.value.from,
            source: historyFocus.value.after,
            sourcePath: historyFocus.value.sourcePath,
          }
          : undefined;
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
            : buildDecorations(
              transaction.state,
              tables,
              callouts,
              sourceFocused,
              restoredTarget,
            ),
        };
      },
      provide: (field) => Prec.highest(EditorView.decorations.from(field, (value) => value.decorations)),
    });
    const viewTracker = ViewPlugin.fromClass(class {
      private readonly calloutTables: CalloutTables;
      private readonly eventDocument: Document;
      private readonly eventWindow: Document["defaultView"];
      private sourceFocusTimer: number | null = null;
      private sourcePointerPending = false;
      private sourcePointerHeld = false;
      private sourcePointerResolved = false;
      private sourcePointerId: number | undefined;
      private readonly resetSourcePointer = (): void => {
        const win = this.eventWindow;
        if (this.sourceFocusTimer !== null && win !== null) win.clearTimeout(this.sourceFocusTimer);
        this.sourceFocusTimer = null;
        this.sourcePointerPending = false;
        this.sourcePointerHeld = false;
        this.sourcePointerResolved = false;
        this.sourcePointerId = undefined;
      };
      private readonly setSourceFocus = (focused: boolean): void => {
        const current = this.view.state.field(decorationField).sourceFocused;
        if (current !== focused) this.view.dispatch({ effects: structuralTableSourceFocus.of(focused) });
      };
      private readonly scheduleSourceFocus = (): void => {
        const win = this.eventWindow;
        if (win === null || this.view.dom.ownerDocument !== this.eventDocument) return;
        if (this.sourceFocusTimer !== null) win.clearTimeout(this.sourceFocusTimer);
        this.sourceFocusTimer = win.setTimeout(() => {
          this.sourceFocusTimer = null;
          if (this.sourcePointerHeld) return;
          if (!this.view.dom.isConnected || this.view.dom.ownerDocument !== this.eventDocument) return;
          const active = this.view.dom.ownerDocument.activeElement;
          const sourceOwned = active !== null
            && this.view.contentDOM.contains(active)
            && active.closest(".structural-tables-live-preview") === null;
          // External controls do not end a source-editing session. Suppressing
          // its range on blur would make CodeMirror relocate the native caret
          // when focus returns. Only a visual-cell interaction yields ownership.
          if (!sourceOwned) return;
          // Touch compatibility focus can arrive after pointerup's task but
          // before CodeMirror resolves the native selection. Revealing the old
          // logical cell here would unmount and recreate its scrolled table.
          if (this.sourcePointerPending && !this.sourcePointerResolved
            && !this.view.state.field(decorationField).sourceFocused) return;
          this.resetSourcePointer();
          this.setSourceFocus(true);
        }, 0);
      };
      private readonly sourceFocusIn = (): void => this.scheduleSourceFocus();
      private readonly sourcePointerUp = (event: PointerEvent): void => {
        if (!this.sourcePointerPending || event.pointerId !== this.sourcePointerId) return;
        this.sourcePointerHeld = false;
        this.scheduleSourceFocus();
      };
      private readonly sourcePointerCancel = (event: PointerEvent): void => {
        if (event.pointerId !== this.sourcePointerId) return;
        this.sourcePointerAbort();
      };
      private readonly sourcePointerAbort = (): void => {
        if (!this.sourcePointerPending) return;
        this.resetSourcePointer();
        this.scheduleSourceFocus();
      };
      private readonly outsidePointerDown = (event: PointerEvent): void => {
        const target = event.target;
        if (this.eventWindow === null || !(target instanceof this.eventWindow.Node) || !this.view.dom.contains(target)
          || this.view.dom.ownerDocument !== this.eventDocument) this.resetSourcePointer();
      };
      private readonly sourceFocusOut = (event: FocusEvent): void => {
        const next = event.relatedTarget;
        if (next instanceof this.view.dom.ownerDocument.defaultView!.Node && !this.view.dom.contains(next)) this.resetSourcePointer();
      };
      private readonly sourceKeyboardIntent = (event: Event): void => {
        if (event.type === "keydown") {
          const key = event as KeyboardEvent;
          if (key.ctrlKey || key.metaKey || key.altKey
            || (key.key.length !== 1 && !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Backspace", "Delete", "Enter"].includes(key.key))) return;
        }
        const target = event.target;
        if (!(target instanceof this.view.dom.ownerDocument.defaultView!.Node) || !this.view.contentDOM.contains(target)) return;
        const element = target.nodeType === 1 ? target as Element : target.parentElement;
        if (element?.closest(".structural-tables-live-preview") !== null) return;
        this.resetSourcePointer();
        this.setSourceFocus(true);
      };
      private readonly sourcePointerDown = (event: PointerEvent): void => {
        if (!event.isPrimary || event.button !== 0) return;
        this.resetSourcePointer();
        const target = event.target;
        if (!(target instanceof this.view.dom.ownerDocument.defaultView!.Node)
          || !this.view.contentDOM.contains(target)) return;
        const element = target.nodeType === 1 ? target as Element : target.parentElement;
        if (element?.closest(".structural-tables-live-preview") !== null) return;
        // Pointer focus arrives before the host resolves its destination. The
        // logical cell cursor still points inside the replaced table here;
        // revealing it would change the geometry under the pending click.
        this.sourcePointerPending = true;
        this.sourcePointerHeld = true;
        this.sourcePointerResolved = this.view.state.field(decorationField).sourceFocused;
        this.sourcePointerId = event.pointerId;
        this.scheduleSourceFocus();
      };
      private readonly sourceFocusCapture = (event: FocusEvent): void => {
        const target = event.target;
        if (!(target instanceof this.view.dom.ownerDocument.defaultView!.Node)
          || !this.view.contentDOM.contains(target)) return;
        const element = target.nodeType === Node.ELEMENT_NODE ? target as Element : target.parentElement;
        if (element?.closest(".structural-tables-live-preview") !== null) return;
        // A later return from an external control ends an unresolved gesture,
        // even if the earlier focusout went through BODY with no relatedTarget.
        if (this.eventWindow !== null && event.relatedTarget instanceof this.eventWindow.Node && event.relatedTarget.isConnected
          && !this.view.dom.contains(event.relatedTarget)) this.resetSourcePointer();
        if (this.sourcePointerPending) return;
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
        // Remove listeners from their original realm even if an old view is
        // adopted into another document before it is destroyed.
        this.eventDocument = view.dom.ownerDocument;
        this.eventWindow = this.eventDocument.defaultView;
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
            widget: (table) => new StructuralTableWidget(app, table, sourcePath, settings, settingsProvider, promote, exportImage),
          };
        });
        views.add(view);
        view.dom.addEventListener("focusin", this.sourceFocusCapture, true);
        view.dom.addEventListener("focusin", this.sourceFocusIn);
        view.dom.addEventListener("focusout", this.sourceFocusOut);
        view.dom.addEventListener("keydown", this.sourceKeyboardIntent, true);
        view.dom.addEventListener("beforeinput", this.sourceKeyboardIntent, true);
        view.dom.addEventListener("pointerdown", this.sourcePointerDown, true);
        this.eventDocument.addEventListener("pointerdown", this.outsidePointerDown, true);
        this.eventDocument.addEventListener("pointerup", this.sourcePointerUp, true);
        this.eventDocument.addEventListener("pointercancel", this.sourcePointerCancel, true);
        this.eventWindow?.addEventListener("blur", this.sourcePointerAbort);
        view.dom.addEventListener("pointerdown", this.clearOtherSelections, true);
        view.dom.addEventListener("focusin", this.clearOtherSelections, true);
      }

      update(update: ViewUpdate): void {
        if ((update.docChanged && !update.transactions.every((transaction) => !transaction.docChanged || isCellBlurCommit(transaction)))
          || update.startState.field(editorInfoField, false)?.file !== update.state.field(editorInfoField, false)?.file
          || update.startState.field(editorInfoField, false)?.editor !== update.state.field(editorInfoField, false)?.editor
          || !settingsProvider().enableLivePreview || !update.state.field(editorLivePreviewField, false)
          || update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false)
          || update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(structuralTableLogicalCursorSync)))) this.resetSourcePointer();
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
        if (this.sourcePointerPending) {
          this.sourcePointerResolved = true;
          this.scheduleSourceFocus();
        }
        for (const host of this.view.dom.querySelectorAll<HTMLElement>(".structural-tables-live-preview")) {
          clearTableWidgetSelection(host);
        }
      }

      destroy(): void {
        cancelPendingTableFocus(this.view);
        this.calloutTables.destroy();
        this.resetSourcePointer();
        this.view.dom.removeEventListener("focusin", this.sourceFocusCapture, true);
        this.view.dom.removeEventListener("focusin", this.sourceFocusIn);
        this.view.dom.removeEventListener("focusout", this.sourceFocusOut);
        this.view.dom.removeEventListener("keydown", this.sourceKeyboardIntent, true);
        this.view.dom.removeEventListener("beforeinput", this.sourceKeyboardIntent, true);
        this.view.dom.removeEventListener("pointerdown", this.sourcePointerDown, true);
        this.eventDocument.removeEventListener("pointerdown", this.outsidePointerDown, true);
        this.eventDocument.removeEventListener("pointerup", this.sourcePointerUp, true);
        this.eventDocument.removeEventListener("pointercancel", this.sourcePointerCancel, true);
        this.eventWindow?.removeEventListener("blur", this.sourcePointerAbort);
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
