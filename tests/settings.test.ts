import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  normalizeStoredSettings,
  sanitizeSettings,
} from "../src/config/settings";

describe("sanitizeSettings", () => {
  it("returns safe defaults for unknown data", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("accepts supported values and rejects unsupported ones", () => {
    expect(sanitizeSettings({
      language: "zh-CN",
      density: "compact",
      layout: "content-center",
      zebraRows: true,
      takeOverOrdinaryTables: true,
      convertHtmlTablePaste: false,
      warnPluginConflicts: false,
    })).toMatchObject({
      language: "zh-CN",
      density: "compact",
      layout: "content-center",
      zebraRows: true,
      takeOverOrdinaryTables: true,
      convertHtmlTablePaste: false,
      warnPluginConflicts: false,
    });
    expect(sanitizeSettings({ language: "fr", density: "dense", layout: "wide" })).toMatchObject({
      language: "auto", density: "comfortable", layout: "content-left",
    });
  });

  it("keeps ordinary-table takeover opt-in", () => {
    expect(DEFAULT_SETTINGS.takeOverOrdinaryTables).toBe(false);
    expect(sanitizeSettings({ takeOverOrdinaryTables: true }).takeOverOrdinaryTables).toBe(true);
    expect(sanitizeSettings({ takeOverOrdinaryTables: "true" }).takeOverOrdinaryTables).toBe(false);
  });

  it("migrates legacy width values to table layouts", () => {
    expect(sanitizeSettings({ width: "content" }).layout).toBe("content-left");
    expect(sanitizeSettings({ width: "full" }).layout).toBe("pane");
    expect(sanitizeSettings({ layout: "content-left", width: "full" }).layout).toBe("content-left");
  });

  it("migrates the unversioned legacy object once into schema 1", () => {
    const legacy = { density: "compact", width: "full", zebraRows: true };
    const before = structuredClone(legacy);
    const migrated = normalizeStoredSettings(legacy);

    expect(migrated).toEqual({
      state: "writable",
      requiresMigration: true,
      data: {
        schemaVersion: 1,
        settings: expect.objectContaining({
          density: "compact",
          layout: "pane",
          zebraRows: true,
        }),
      },
    });
    expect(legacy).toEqual(before);
    if (migrated.state === "writable") {
      expect(normalizeStoredSettings(migrated.data)).toEqual({
        ...migrated,
        requiresMigration: false,
      });
    }
  });

  it("loads schema 1 normally with pure, idempotent, detached normalization", () => {
    const stored = {
      schemaVersion: 1,
      settings: { density: "compact", layout: "content-center" },
    };
    const before = structuredClone(stored);
    const first = normalizeStoredSettings(stored);

    expect(first).toMatchObject({
      state: "writable",
      requiresMigration: false,
      data: {
        schemaVersion: 1,
        settings: { density: "compact", layout: "content-center" },
      },
    });
    expect(stored).toEqual(before);
    if (first.state === "writable") {
      const second = normalizeStoredSettings(first.data);
      expect(second).toEqual(first);
      first.data.settings.density = "comfortable";
      expect(stored).toEqual(before);
    }
  });

  it("fails closed for future and malformed explicit schemas", () => {
    const candidates: unknown[] = [
      { schemaVersion: 2, settings: { density: "compact", futureField: true } },
      { schemaVersion: "1", settings: { density: "compact" } },
      { schemaVersion: 1, settings: null },
      { schemaVersion: undefined, settings: { density: "compact" } },
    ];

    for (const candidate of candidates) {
      const before = structuredClone(candidate);
      expect(normalizeStoredSettings(candidate)).toMatchObject({
        state: "incompatible",
        settings: DEFAULT_SETTINGS,
      });
      expect(candidate).toEqual(before);
    }
  });

  it("does not migrate a fresh installation with no stored data", () => {
    expect(normalizeStoredSettings(null)).toEqual({
      state: "writable",
      requiresMigration: false,
      data: { schemaVersion: 1, settings: DEFAULT_SETTINGS },
    });
  });
});
