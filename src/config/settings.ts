export type InterfaceLanguage = "auto" | "en" | "zh-CN";
export type TableDensity = "comfortable" | "compact";
export type TableWidth = "content" | "full";

export interface StructuralTablesSettings {
  language: InterfaceLanguage;
  enableReadingView: boolean;
  enableLivePreview: boolean;
  showDiagnostics: boolean;
  density: TableDensity;
  width: TableWidth;
  zebraRows: boolean;
}

export const DEFAULT_SETTINGS: StructuralTablesSettings = {
  language: "auto",
  enableReadingView: true,
  enableLivePreview: true,
  showDiagnostics: true,
  density: "comfortable",
  width: "content",
  zebraRows: false,
};

export function sanitizeSettings(data: unknown): StructuralTablesSettings {
  const source = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  return {
    language: source.language === "en" || source.language === "zh-CN" ? source.language : "auto",
    enableReadingView: source.enableReadingView !== false,
    enableLivePreview: source.enableLivePreview !== false,
    showDiagnostics: source.showDiagnostics !== false,
    density: source.density === "compact" ? "compact" : "comfortable",
    width: source.width === "full" ? "full" : "content",
    zebraRows: source.zebraRows === true,
  };
}
