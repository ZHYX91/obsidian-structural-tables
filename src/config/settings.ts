export type InterfaceLanguage = "auto" | "en" | "zh-CN";
export type TableDensity = "comfortable" | "compact";
export type TableLayout = "content-left" | "content-center" | "pane";

export interface StructuralTablesSettings {
  language: InterfaceLanguage;
  convertHtmlTablePaste: boolean;
  warnPluginConflicts: boolean;
  enableReadingView: boolean;
  enableLivePreview: boolean;
  takeOverOrdinaryTables: boolean;
  showDiagnostics: boolean;
  density: TableDensity;
  layout: TableLayout;
  zebraRows: boolean;
}

export const DEFAULT_SETTINGS: StructuralTablesSettings = {
  language: "auto",
  convertHtmlTablePaste: true,
  warnPluginConflicts: true,
  enableReadingView: true,
  enableLivePreview: true,
  takeOverOrdinaryTables: false,
  showDiagnostics: true,
  density: "comfortable",
  layout: "content-left",
  zebraRows: false,
};

function sanitizeLayout(source: Record<string, unknown>): TableLayout {
  if (source.layout === "content-left" || source.layout === "content-center" || source.layout === "pane") {
    return source.layout;
  }
  if (source.width === "full") return "pane";
  return "content-left";
}

export function sanitizeSettings(data: unknown): StructuralTablesSettings {
  const source = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  return {
    language: source.language === "en" || source.language === "zh-CN" ? source.language : "auto",
    convertHtmlTablePaste: source.convertHtmlTablePaste !== false,
    warnPluginConflicts: source.warnPluginConflicts !== false,
    enableReadingView: source.enableReadingView !== false,
    enableLivePreview: source.enableLivePreview !== false,
    takeOverOrdinaryTables: source.takeOverOrdinaryTables === true,
    showDiagnostics: source.showDiagnostics !== false,
    density: source.density === "compact" ? "compact" : "comfortable",
    layout: sanitizeLayout(source),
    zebraRows: source.zebraRows === true,
  };
}
