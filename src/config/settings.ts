import { sanitizeInterfaceLanguage, type InterfaceLanguage } from "./locale";
import type { TableSourceSyntax } from "../core/model";

export type { InterfaceLanguage } from "./locale";
export type TableDensity = "theme" | "comfortable" | "compact";
export type TableLayout = "theme" | "content-left" | "content-center" | "pane";
export type TableAppearance = "theme" | "grid" | "three-line";

export interface StructuralTablesSettings {
  language: InterfaceLanguage;
  convertHtmlTablePaste: boolean;
  defaultSourceSyntax: TableSourceSyntax;
  warnPluginConflicts: boolean;
  enableReadingView: boolean;
  enableLivePreview: boolean;
  takeOverOrdinaryTables: boolean;
  showDiagnostics: boolean;
  density: TableDensity;
  layout: TableLayout;
  appearance: TableAppearance;
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
  defaultSourceSyntax: "compatible",
  warnPluginConflicts: true,
  enableReadingView: true,
  enableLivePreview: true,
  takeOverOrdinaryTables: false,
  showDiagnostics: true,
  density: "theme",
  layout: "theme",
  appearance: "theme",
  zebraRows: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function sanitizeLayout(source: Record<string, unknown>): TableLayout {
  if (source.layout === "theme" || source.layout === "content-left" || source.layout === "content-center" || source.layout === "pane") {
    return source.layout;
  }
  if (source.width === "full") return "pane";
  if (source.width === "content") return "content-left";
  return "theme";
}

export function sanitizeSettings(data: unknown): StructuralTablesSettings {
  const source = isRecord(data) ? data : {};
  return {
    language: sanitizeInterfaceLanguage(source.language),
    convertHtmlTablePaste: source.convertHtmlTablePaste !== false,
    defaultSourceSyntax: source.defaultSourceSyntax === "compact" ? "compact" : "compatible",
    warnPluginConflicts: source.warnPluginConflicts !== false,
    enableReadingView: source.enableReadingView !== false,
    enableLivePreview: source.enableLivePreview !== false,
    takeOverOrdinaryTables: source.takeOverOrdinaryTables === true,
    showDiagnostics: source.showDiagnostics !== false,
    density: source.density === "compact" || source.density === "comfortable" ? source.density : "theme",
    layout: sanitizeLayout(source),
    appearance: source.appearance === "grid" || source.appearance === "three-line" ? source.appearance : "theme",
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
