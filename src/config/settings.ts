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

export interface PersistedStructuralTablesData {
  schemaVersion: 1;
  settings: StructuralTablesSettings;
}

export type NormalizedStructuralTablesData = Readonly<
  | {
    state: "writable";
    data: PersistedStructuralTablesData;
    requiresMigration: boolean;
  }
  | {
    state: "incompatible";
    schemaVersion: string;
    settings: StructuralTablesSettings;
  }
>;

export const SETTINGS_SCHEMA_VERSION = 1 as const;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function sanitizeLayout(source: Record<string, unknown>): TableLayout {
  if (source.layout === "content-left" || source.layout === "content-center" || source.layout === "pane") {
    return source.layout;
  }
  if (source.width === "full") return "pane";
  return "content-left";
}

export function sanitizeSettings(data: unknown): StructuralTablesSettings {
  const source = isRecord(data) ? data : {};
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

export function cloneSettings(settings: StructuralTablesSettings): StructuralTablesSettings {
  return structuredClone(settings);
}

export function normalizeStoredSettings(data: unknown): NormalizedStructuralTablesData {
  if (isRecord(data) && hasOwn(data, "schemaVersion")) {
    if (
      data.schemaVersion !== SETTINGS_SCHEMA_VERSION
      || !isRecord(data.settings)
    ) {
      return {
        state: "incompatible",
        schemaVersion: describeSchemaVersion(data.schemaVersion),
        settings: cloneSettings(DEFAULT_SETTINGS),
      };
    }
    return {
      state: "writable",
      data: {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        settings: sanitizeSettings(data.settings),
      },
      requiresMigration: false,
    };
  }

  const legacy = isRecord(data);
  return {
    state: "writable",
    data: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: legacy ? sanitizeSettings(data) : cloneSettings(DEFAULT_SETTINGS),
    },
    requiresMigration: legacy,
  };
}

function describeSchemaVersion(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return JSON.stringify(value.slice(0, 40));
  if (value === null) return "null";
  return "invalid";
}
