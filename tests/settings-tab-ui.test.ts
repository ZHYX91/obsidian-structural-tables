import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { moveSettingsTabIndex } from "../src/app/settings-tab-navigation";

describe("settings tab UI", () => {
  it("supports wrapping horizontal navigation in LTR and RTL", () => {
    expect(moveSettingsTabIndex(0, "ArrowRight", 3, "ltr")).toBe(1);
    expect(moveSettingsTabIndex(0, "ArrowLeft", 3, "ltr")).toBe(2);
    expect(moveSettingsTabIndex(0, "ArrowLeft", 3, "rtl")).toBe(1);
    expect(moveSettingsTabIndex(0, "ArrowRight", 3, "rtl")).toBe(2);
    expect(moveSettingsTabIndex(2, "Home", 3, "ltr")).toBe(0);
    expect(moveSettingsTabIndex(0, "End", 3, "ltr")).toBe(2);
    expect(moveSettingsTabIndex(1, "Enter", 3, "ltr")).toBeNull();
  });

  it("uses one labelled tab panel without a duplicate plugin heading", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/app/settings-tab.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain('"aria-orientation": "horizontal"');
    expect(source).toContain('role: "tabpanel"');
    expect(source).toContain('tabindex: "0"');
    expect(source).toContain('t("settings.takeoverOrdinary")');
    expect(source).not.toContain("getSettingDefinitions(");
    expect(source).not.toContain('setName(t("settings.title")).setHeading()');
  });

  it("keeps tabs scrollable, theme-neutral, scalable, and touch-sized", () => {
    const styles = readFileSync(
      fileURLToPath(new URL("../styles.css", import.meta.url)),
      "utf8",
    );
    expect(styles).toContain("overflow-x: auto");
    expect(styles).toContain("font-size: var(--font-ui-small) !important");
    expect(styles).toContain("background: transparent !important");
    expect(styles).toContain("min-block-size: 34px");
    expect(styles).toContain("font-weight: var(--font-semibold) !important");
    expect(styles).toContain("margin-block-start: var(--size-4-5)");
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*min-block-size: 44px/u);
  });

  it("uses distinct theme-aware backgrounds for column and row headers", () => {
    const styles = readFileSync(
      fileURLToPath(new URL("../styles.css", import.meta.url)),
      "utf8",
    );
    expect(styles).toContain("--structural-table-column-header-background");
    expect(styles).toContain("--structural-table-row-header-background");
    expect(styles).toMatch(/th:is\(\[scope="row"\], \[scope="rowgroup"\]\)[\s\S]*background: var\(--structural-table-row-header-background\)/u);
    expect(styles).toMatch(/\[data-zebra="true"\][\s\S]*tbody tr:nth-child\(even\) \{/u);
  });

  it("uses span-aware edges, stable row heights, and visible keyboard focus", () => {
    const styles = readFileSync(
      fileURLToPath(new URL("../styles.css", import.meta.url)),
      "utf8",
    );
    expect(styles).toContain('[data-structural-block-end="true"]');
    expect(styles).toContain('[data-structural-inline-end="true"]');
    expect(styles).toContain("height: 2.5rem");
    expect(styles).toMatch(/is-interactive :is\(th, td\):focus-visible[\s\S]*outline: 2px solid/u);
  });
});
