import { getLanguage } from "obsidian";

import type { OperationCode } from "../core/operations";
import type { TableDiagnostic } from "../core/model";
import { LOCALES, resolveLocale, type InterfaceLanguage, type LocaleId } from "./locale";
import en, { type TranslationCatalog, type TranslationKey } from "./locales/en";
import zhCN from "./locales/zh-CN";
import zhTW from "./locales/zh-TW";
import ja from "./locales/ja";
import de from "./locales/de";
import es from "./locales/es";
import ar from "./locales/ar";

export type { TranslationKey } from "./locales/en";

export const TRANSLATIONS = { en, "zh-CN": zhCN, "zh-TW": zhTW, ja, de, es, ar } satisfies Record<LocaleId, TranslationCatalog>;

export type Translate = ((key: TranslationKey) => string) & { readonly locale?: LocaleId };

export function createTranslator(language: InterfaceLanguage): Translate {
  const locale = resolveLocale(language, getLanguage());
  const selected: TranslationCatalog = TRANSLATIONS[locale];
  return Object.assign((key: TranslationKey): string => {
    const text = selected[key];
    // Isolate interpolated paths, numbers and code from surrounding RTL prose.
    return locale === "ar" ? text.replace(/\{[a-zA-Z]+\}/gu, "\u2068$&\u2069") : text;
  }, { locale });
}

export function applyInterfaceLocale(element: HTMLElement, language: Translate | LocaleId = "en"): void {
  const locale = typeof language === "string" ? language : language.locale ?? "en";
  element.setAttribute("lang", locale);
  element.setAttribute("dir", LOCALES.find((entry) => entry.id === locale)!.direction);
  element.setAttribute("data-structural-interface", "true");
}

const operationKeys: Record<OperationCode, TranslationKey> = {
  "already-merged": "operation.alreadyMerged",
  "cell-unavailable": "operation.cellUnavailable",
  "cell-edited": "operation.cellEdited",
  "cells-cleared": "operation.cellsCleared",
  "math-pipe-unsafe": "operation.mathPipeUnsafe",
  "math-multiline-unsafe": "operation.mathMultilineUnsafe",
  "math-syntax-unsafe": "operation.mathSyntaxUnsafe",
  "column-aligned": "operation.columnAligned",
  "column-inserted": "operation.columnInserted",
  "column-moved": "operation.columnMoved",
  "columns-deleted": "operation.columnsDeleted",
  "content-would-be-lost": "operation.contentWouldBeLost",
  "gfm-overflow-readonly": "operation.gfmOverflowReadonly",
  "header-count-invalid": "operation.headerCountInvalid",
  "header-rows-set": "operation.headerRowsSet",
  "invalid-result": "operation.invalidResult",
  "merge-crosses-role": "operation.mergeCrossesRole",
  "merge-invalid-selection": "operation.mergeInvalidSelection",
  "merge-partial-existing": "operation.mergePartialExisting",
  "move-crosses-header": "operation.moveCrossesHeader",
  "move-partial-merge": "operation.movePartialMerge",
  "move-selection-unavailable": "operation.moveSelectionUnavailable",
  merged: "operation.merged",
  "no-adjacent-cell": "operation.noAdjacentCell",
  "not-merged": "operation.notMerged",
  "row-header-count-invalid": "operation.rowHeaderCountInvalid",
  "row-headers-set": "operation.rowHeadersSet",
  "row-inserted": "operation.rowInserted",
  "row-moved": "operation.rowMoved",
  "rows-deleted": "operation.rowsDeleted",
  "range-pasted": "operation.rangePasted",
  "row-unavailable": "operation.rowUnavailable",
  split: "operation.split",
  "split-unsafe": "operation.splitUnsafe",
  "table-deleted": "operation.tableDeleted",
  "table-invalid": "operation.tableInvalid",
  "table-transposed": "operation.tableTransposed",
  "transpose-unrepresentable": "operation.transposeUnrepresentable",
};

export function operationNotice(t: Translate, code: OperationCode): string {
  return t(operationKeys[code]);
}

const diagnosticKeys: Record<TableDiagnostic["code"], TranslationKey> = {
  "boundary-at-edge": "diagnostic.boundaryAtEdge",
  "boundary-count": "diagnostic.boundaryCount",
  "boundary-token": "diagnostic.boundaryToken",
  "merge-boundary": "diagnostic.mergeBoundary",
  "merge-missing-anchor": "diagnostic.mergeMissingAnchor",
  "merge-nonrectangular": "diagnostic.mergeNonrectangular",
  "row-width": "diagnostic.rowWidth",
};

export function diagnosticNotice(t: Translate, diagnostic: TableDiagnostic): string {
  return t(diagnosticKeys[diagnostic.code]);
}

export function withCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}
