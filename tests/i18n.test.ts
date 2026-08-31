import { describe, expect, it } from "vitest";

import { createTranslator, operationNotice, withCount } from "../src/config/i18n";

describe("i18n", () => {
  it("labels automatic language as following Obsidian", () => {
    expect(createTranslator("auto")("settings.language.auto")).toBe("Follow Obsidian");
    expect(createTranslator("zh-CN")("settings.language.auto")).toBe("跟随 Obsidian");
  });

  it("distinguishes table layout from cell-content alignment", () => {
    expect(createTranslator("en")("settings.layout.contentCenter")).toBe("Fit content — Center");
    expect(createTranslator("zh-CN")("settings.layout.pane")).toBe("适应窗格宽度");
  });

  it("localizes interchange commands and settings", () => {
    expect(createTranslator("en")("command.copyHtml")).toBe("Copy current table as HTML");
    expect(createTranslator("en")("modal.format.confirm")).toBe("Format table");
    expect(createTranslator("zh-CN")("modal.format.title")).toBe("格式化结构表格");
    expect(createTranslator("zh-CN")("settings.htmlPaste")).toBe("保留粘贴 HTML 表格的合并结构");
    expect(createTranslator("zh-CN")("menu.flattenAndPromoteBase")).toBe("展开结构并升级为 Base…");
  });

  it("localizes operation notices and count templates", () => {
    const t = createTranslator("zh-CN");
    expect(operationNotice(t, "merged")).toBe("已合并单元格。");
    expect(withCount(t("menu.setHeaderRows"), 3)).toBe("将前 3 行设为列标题");
  });
});
