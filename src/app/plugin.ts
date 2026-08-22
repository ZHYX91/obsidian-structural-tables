import { MarkdownView, Notice, Plugin, type Command, type Editor, type Menu } from "obsidian";

import { createTranslator, operationNotice, withCount } from "../config/i18n";
import { DEFAULT_SETTINGS, sanitizeSettings, type StructuralTablesSettings } from "../config/settings";
import {
  cellColumnAt,
  mergeCell,
  mergeCellRange,
  setHeaderRowCount,
  setRowHeaderColumnCount,
  splitCell,
  type MergeDirection,
  type OperationResult,
} from "../core/operations";
import { parseStructuralTables } from "../core/parser";
import { serializeStructuralTable } from "../core/serializer";
import type { StructuralTable } from "../core/model";
import { StructuralTableEditorController } from "../editor/table-live-preview";
import { selectedStructuralTableCells, type StructuralTableSelection } from "../editor/table-selection";
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
  private readonly localizedCommands: Command[] = [];

  override async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());
    this.editorController = new StructuralTableEditorController(this.app, () => this.settings);
    this.registerEditorExtension(this.editorController.createExtension());
    const reading = new StructuralTableReadingProcessor(this.app, () => this.settings);
    this.registerMarkdownPostProcessor((element, context) => reading.process(element, context));
    this.addSettingTab(new StructuralTablesSettingTab(this.app, this));
    this.registerCommands();
    this.registerEditorMenu();
  }

  async updateSettings(update: Partial<StructuralTablesSettings>): Promise<void> {
    this.settings = sanitizeSettings({ ...this.settings, ...update });
    await this.saveData(this.settings);
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
      if (selection === null || !selection.table.valid || !selection.rectangular) return;
      this.addSelectionMenuItems(menu, editor, selection);
    }));
  }

  private addSelectionMenuItems(menu: Menu, editor: Editor, selection: StructuralTableSelection): void {
    const t = createTranslator(this.settings.language);
    const { table } = selection;
    if (selection.cells.length > 1) {
      menu.addItem((item) => item
        .setSection("structural-tables")
        .setIcon("combine")
        .setTitle(t("menu.mergeSelection"))
        .onClick(() => this.applyOperation(editor, table, mergeCellRange(
          table,
          selection.minRow,
          selection.minColumn,
          selection.maxRow,
          selection.maxColumn,
        ))));
    }
    if (selection.cells.length === 1) {
      const cell = selection.cells[0];
      const anchor = cell === undefined ? undefined : table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
      if (anchor !== undefined && (anchor.rowSpan > 1 || anchor.columnSpan > 1)) {
        menu.addItem((item) => item
          .setSection("structural-tables")
          .setIcon("split")
          .setTitle(t("menu.splitCell"))
          .onClick(() => this.applyOperation(editor, table, splitCell(table, cell?.row ?? -1, cell?.column ?? -1))));
      }
    }
    const selectsWholeRows = selection.minRow === 0
      && selection.minColumn === 0
      && selection.maxColumn === table.columnCount - 1;
    if (selectsWholeRows) {
      const count = selection.maxRow + 1;
      menu.addItem((item) => item
        .setSection("structural-tables")
        .setIcon("rows-3")
        .setTitle(withCount(t("menu.setHeaderRows"), count))
        .onClick(() => this.applyOperation(editor, table, setHeaderRowCount(table, count))));
    }
    const selectsWholeColumns = selection.minColumn === 0
      && selection.minRow === 0
      && selection.maxRow === table.rows.length - 1;
    if (selectsWholeColumns && selection.maxColumn < table.columnCount - 1) {
      const count = selection.maxColumn + 1;
      menu.addItem((item) => item
        .setSection("structural-tables")
        .setIcon("columns-3")
        .setTitle(withCount(t("menu.setRowHeaderColumns"), count))
        .onClick(() => this.applyOperation(editor, table, setRowHeaderColumnCount(table, count))));
    }
    if (selectsWholeColumns && table.rowHeaderColumnCount > 0) {
      menu.addItem((item) => item
        .setSection("structural-tables")
        .setIcon("columns-2")
        .setTitle(t("menu.removeRowHeaders"))
        .onClick(() => this.applyOperation(editor, table, setRowHeaderColumnCount(table, 0))));
    }
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

  private noTable(): void {
    new Notice(createTranslator(this.settings.language)("notice.noTable"));
  }
}
