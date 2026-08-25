export type InterfaceLanguage = "auto" | "en" | "zh-CN";
export type TableDensity = "comfortable" | "compact";
export type TableLayout = "content-left" | "content-center" | "pane";

export interface StructuralTablesSettings {
  language: InterfaceLanguage;
  enableReadingView: boolean;
  enableLivePreview: boolean;
  showDiagnostics: boolean;
  density: TableDensity;
  layout: TableLayout;
  zebraRows: boolean;
}

export const DEFAULT_SETTINGS: StructuralTablesSettings = {
  language: "auto",
  enableReadingView: true,
  enableLivePreview: true,
  showDiagnostics: true,
  density: "comfortable",
  layout: "pane",
  zebraRows: false,
};

function sanitizeLayout(source: Record<string, unknown>): TableLayout {
  if (source.layout === "content-left" || source.layout === "content-center" || source.layout === "pane") {
    return source.layout;
  }
  return source.width === "content" ? "content-left" : "pane";
}

export function sanitizeSettings(data: unknown): StructuralTablesSettings {
  const source = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  return {
    language: source.language === "en" || source.language === "zh-CN" ? source.language : "auto",
    enableReadingView: source.enableReadingView !== false,
    enableLivePreview: source.enableLivePreview !== false,
    showDiagnostics: source.showDiagnostics !== false,
    density: source.density === "compact" ? "compact" : "comfortable",
    layout: sanitizeLayout(source),
    zebraRows: source.zebraRows === true,
  };
}
