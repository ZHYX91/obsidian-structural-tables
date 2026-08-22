import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/config/settings";

describe("sanitizeSettings", () => {
  it("returns safe defaults for unknown data", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("accepts supported values and rejects unsupported ones", () => {
    expect(sanitizeSettings({ language: "zh-CN", density: "compact", width: "full", zebraRows: true })).toMatchObject({
      language: "zh-CN", density: "compact", width: "full", zebraRows: true,
    });
    expect(sanitizeSettings({ language: "fr", density: "dense", width: "wide" })).toMatchObject({
      language: "auto", density: "comfortable", width: "content",
    });
  });
});
