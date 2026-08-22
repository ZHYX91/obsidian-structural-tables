import { MarkdownView, Notice, Plugin, type Editor } from "obsidian";

import { createTranslator } from "../config/i18n";
import { DEFAULT_SETTINGS, sanitizeSettings, type StructuralTablesSettings } from "../config/settings";
import { cellColumnAt, mergeCell, splitCell, type MergeDirection } from "../core/operations";
import { parseStructuralTables } from "../core/parser";
import { serializeStructuralTable } from "../core/serializer";
import type { StructuralTable } from "../core/model";
import { StructuralTableEditorController } from "../editor/table-live-preview";
import { StructuralTableReadingProcessor } from "../reading/table-postprocessor";
import { StructuralTablesSettingTab } from "./settings-tab";

const TEMPLATE = `| Region | Sales | < |
| Quarter | Q1 | Q2 |
| --- || --- | --- |
| North | 10 | 12 |
| ^ | 8 | 11 |`;

export class StructuralTablesPlugin extends Plugin {
  override settings: StructuralTablesSettings = { ...DEFAULT_SETTINGS };
  private editorController: StructuralTableEditorController | null = null;

  override async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());
    this.editorController = new StructuralTableEditorController(this.app, () => this.settings);
    this.registerEditorExtension(this.editorController.createExtension());
    const reading = new StructuralTableReadingProcessor(this.app, () => this.settings);
    this.registerMarkdownPostProcessor((element, context) => reading.process(element, context));
    this.addSettingTab(new StructuralTablesSettingTab(this.app, this));
    this.registerCommands();
  }

  async updateSettings(update: Partial<StructuralTablesSettings>): Promise<void> {
    this.settings = sanitizeSettings({ ...this.settings, ...update });
    await this.saveData(this.settings);
    this.editorController?.refresh();
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
    });
  }

  private registerCommands(): void {
    const t = createTranslator(this.settings.language);
    this.addCommand({
      id: "insert-structural-table",
      name: t("command.insert"),
      editorCallback: (editor) => {
        editor.replaceSelection(TEMPLATE);
        new Notice(createTranslator(this.settings.language)("notice.inserted"));
      },
    });
    this.addCommand({
      id: "format-current-structural-table",
      name: t("command.format"),
      editorCallback: (editor) => this.formatCurrent(editor),
    });
    this.addCommand({ id: "merge-current-cell-left", name: t("command.mergeLeft"), editorCallback: (editor) => this.editMerge(editor, "left") });
    this.addCommand({ id: "merge-current-cell-up", name: t("command.mergeUp"), editorCallback: (editor) => this.editMerge(editor, "up") });
    this.addCommand({ id: "split-current-merged-cell", name: t("command.split"), editorCallback: (editor) => this.editSplit(editor) });
    this.addCommand({
      id: "validate-current-note",
      name: t("command.validate"),
      editorCallback: (editor) => {
        const tables = parseStructuralTables(editor.getValue()).tables;
        const diagnostics = tables.flatMap((table) => table.diagnostics);
        new Notice(diagnostics.length === 0
          ? createTranslator(this.settings.language)("notice.valid")
          : diagnostics.map((diagnostic) => `Line ${diagnostic.row + 1}: ${diagnostic.message}`).join("\n"));
      },
    });
  }

  private currentTable(editor: Editor): { table: StructuralTable; row: number; column: number } | null {
    const cursor = editor.getCursor();
    const offset = editor.posToOffset(cursor);
    const table = parseStructuralTables(editor.getValue()).tables.find((candidate) => offset >= candidate.range.from && offset <= candidate.range.to);
    if (table === undefined) return null;
    const row = table.rows.findIndex((candidate) => candidate.sourceLine === cursor.line);
    if (row < 0) return { table, row: -1, column: -1 };
    const column = cellColumnAt(editor.getLine(cursor.line), cursor.ch);
    return { table, row, column: Math.min(column ?? 0, table.columnCount - 1) };
  }

  private replaceTable(editor: Editor, table: StructuralTable, source: string): void {
    editor.replaceRange(source, editor.offsetToPos(table.range.from), editor.offsetToPos(table.range.to));
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
    if (result.changed) this.replaceTable(editor, current.table, result.source);
    new Notice(result.message);
  }

  private editSplit(editor: Editor): void {
    const current = this.currentTable(editor);
    if (current === null || current.row < 0) return this.noTable();
    const result = splitCell(current.table, current.row, current.column);
    if (result.changed) this.replaceTable(editor, current.table, result.source);
    new Notice(result.message);
  }

  private noTable(): void {
    new Notice(createTranslator(this.settings.language)("notice.noTable"));
  }
}
