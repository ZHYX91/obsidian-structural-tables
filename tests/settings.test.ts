import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/config/settings";

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
});
