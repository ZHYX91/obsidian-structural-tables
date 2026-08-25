import { MarkdownView, Notice, Plugin, type Command, type Editor } from "obsidian";

import { createTranslator, operationNotice } from "../config/i18n";
import { DEFAULT_SETTINGS, sanitizeSettings, type StructuralTablesSettings } from "../config/settings";
import {
  cellColumnAt,
  mergeCell,
  splitCell,
  type MergeDirection,
  type OperationResult,
} from "../core/operations";
import { parseEditableTables, parseStructuralTables } from "../core/parser";
import { serializeStructuralTable } from "../core/serializer";
import { reparseUnchangedTable } from "../core/table-snapshot";
import type { StructuralTable } from "../core/model";
import { NativeTableMenuBridge } from "../editor/native-table-menu";
import { StructuralTableEditorController } from "../editor/table-live-preview";
import { addSelectionMenuItems, hasSelectionMenuItems, type TableOperation } from "../editor/table-menu";
import { replaceTableSource } from "../editor/table-replacement";
import { selectedStructuralTableCells } from "../editor/table-selection";
import { StructuralTableReadingProcessor } from "../reading/table-postprocessor";
import { StructuralTablesSettingTab } from "./settings-tab";
import { SettingsSaveCoordinator } from "./settings-save-coordinator";

const TEMPLATE = `| Region | Sales | < |
| Quarter | Q1 | Q2 |
| --- || --- | --- |
| North | 10 | 12 |
| ^ | 8 | 11 |`;

export class StructuralTablesPlugin extends Plugin {
  override settings: StructuralTablesSettings = { ...DEFAULT_SETTINGS };
  private editorController: StructuralTableEditorController | null = null;
  private readonly localizedCommands: Command[] = [];
  private readonly settingsSaver = new SettingsSaveCoordinator<StructuralTablesSettings>(
    (snapshot) => this.saveData(snapshot),
  );

  override async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());
    this.editorController = new StructuralTableEditorController(this.app, () => this.settings);
    this.registerEditorExtension(this.editorController.createExtension());
    const reading = new StructuralTableReadingProcessor(this.app, () => this.settings);
    this.registerMarkdownPostProcessor((element, context) => reading.process(element, context));
    new NativeTableMenuBridge(this.app, () => this.settings).register(this);
    this.addSettingTab(new StructuralTablesSettingTab(this.app, this));
    this.registerCommands();
    this.registerEditorMenu();
  }

  async updateSettings(update: Partial<StructuralTablesSettings>): Promise<void> {
    this.settings = sanitizeSettings({ ...this.settings, ...update });
    await this.settingsSaver.save(this.settings);
    this.refreshCommandNames();
    this.editorController?.refresh();
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
    });
  }

  private registerCommands(): void {
    const t = createTranslator(this.settings.language);
    this.localizedCommands.push(this.addCommand({
      id: "insert-structural-table",
      name: t("command.insert"),
      editorCallback: (editor) => {
        editor.replaceSelection(TEMPLATE);
        new Notice(createTranslator(this.settings.language)("notice.inserted"));
      },
    }));
    this.localizedCommands.push(this.addCommand({
      id: "format-current-structural-table",
      name: t("command.format"),
      editorCallback: (editor) => this.formatCurrent(editor),
    }));
    this.localizedCommands.push(this.addCommand({ id: "merge-current-cell-left", name: t("command.mergeLeft"), editorCallback: (editor) => this.editMerge(editor, "left") }));
    this.localizedCommands.push(this.addCommand({ id: "merge-current-cell-up", name: t("command.mergeUp"), editorCallback: (editor) => this.editMerge(editor, "up") }));
    this.localizedCommands.push(this.addCommand({ id: "split-current-merged-cell", name: t("command.split"), editorCallback: (editor) => this.editSplit(editor) }));
    this.localizedCommands.push(this.addCommand({
      id: "validate-current-note",
      name: t("command.validate"),
      editorCallback: (editor) => {
        const tables = parseStructuralTables(editor.getValue()).tables;
        const diagnostics = tables.flatMap((table) => table.diagnostics);
        new Notice(diagnostics.length === 0
          ? createTranslator(this.settings.language)("notice.valid")
          : diagnostics.map((diagnostic) => `Line ${diagnostic.row + 1}: ${diagnostic.message}`).join("\n"));
      },
    }));
  }

  private refreshCommandNames(): void {
    const t = createTranslator(this.settings.language);
    const names: Record<string, string> = {
      "format-current-structural-table": t("command.format"),
      "insert-structural-table": t("command.insert"),
      "merge-current-cell-left": t("command.mergeLeft"),
      "merge-current-cell-up": t("command.mergeUp"),
      "split-current-merged-cell": t("command.split"),
      "validate-current-note": t("command.validate"),
    };
    for (const command of this.localizedCommands) command.name = names[command.id] ?? command.name;
  }

  private registerEditorMenu(): void {
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      const selection = selectedStructuralTableCells(editor);
      if (selection === null || !selection.table.valid || !selection.rectangular || !hasSelectionMenuItems(selection)) return;
      addSelectionMenuItems(
        menu,
        createTranslator(this.settings.language),
        selection,
        (operation) => this.applyMenuOperation(editor, selection.table, operation),
      );
    }));
  }

  private currentTable(editor: Editor): { table: StructuralTable; row: number; column: number } | null {
    const cursor = editor.getCursor();
    const offset = editor.posToOffset(cursor);
    const table = parseEditableTables(editor.getValue()).tables.find((candidate) => offset >= candidate.range.from && offset <= candidate.range.to);
    if (table === undefined) return null;
    const row = table.rows.findIndex((candidate) => candidate.sourceLine === cursor.line);
    if (row < 0) return { table, row: -1, column: -1 };
    const column = cellColumnAt(editor.getLine(cursor.line), cursor.ch);
    return { table, row, column: Math.min(column ?? 0, table.columnCount - 1) };
  }

  private replaceTable(editor: Editor, table: StructuralTable, source: string): void {
    replaceTableSource(editor, table, source);
  }

  private formatCurrent(editor: Editor): void {
    const current = this.currentTable(editor);
    if (current === null) return this.noTable();
    if (!current.table.valid) {
      new Notice(current.table.diagnostics[0]?.message ?? "Invalid structural table.");
      return;
    }
    this.replaceTable(editor, current.table, serializeStructuralTable(current.table));
    new Notice(createTranslator(this.settings.language)("notice.formatted"));
  }

  private editMerge(editor: Editor, direction: MergeDirection): void {
    const current = this.currentTable(editor);
    if (current === null || current.row < 0) return this.noTable();
    const result = mergeCell(current.table, current.row, current.column, direction);
    this.applyOperation(editor, current.table, result);
  }

  private editSplit(editor: Editor): void {
    const current = this.currentTable(editor);
    if (current === null || current.row < 0) return this.noTable();
    const result = splitCell(current.table, current.row, current.column);
    this.applyOperation(editor, current.table, result);
  }

  private applyOperation(editor: Editor, table: StructuralTable, result: OperationResult): void {
    if (result.changed) this.replaceTable(editor, table, result.source);
    new Notice(operationNotice(createTranslator(this.settings.language), result.code));
  }

  private applyMenuOperation(
    editor: Editor,
    expected: StructuralTable,
    operation: TableOperation,
  ): void {
    const current = reparseUnchangedTable(editor.getValue(), expected);
    if (current === null) {
      new Notice(createTranslator(this.settings.language)("notice.staleTable"));
      return;
    }
    this.applyOperation(editor, current, operation(current));
  }

  private noTable(): void {
    new Notice(createTranslator(this.settings.language)("notice.noTable"));
  }
}
