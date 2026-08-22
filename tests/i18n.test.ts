import { describe, expect, it } from "vitest";

import { createTranslator, operationNotice, withCount } from "../src/config/i18n";

describe("i18n", () => {
  it("labels automatic language as following Obsidian", () => {
    expect(createTranslator("auto")("settings.language.auto")).toBe("Follow Obsidian");
    expect(createTranslator("zh-CN")("settings.language.auto")).toBe("跟随 Obsidian");
  });

  it("localizes operation notices and count templates", () => {
    const t = createTranslator("zh-CN");
    expect(operationNotice(t, "merged")).toBe("已合并单元格。");
    expect(withCount(t("menu.setHeaderRows"), 3)).toBe("将前 3 行设为列标题");
  });
});
