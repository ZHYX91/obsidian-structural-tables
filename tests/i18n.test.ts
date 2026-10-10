import { describe, expect, it } from "vitest";

import { createTranslator, operationNotice, withCount } from "../src/config/i18n";

describe("i18n", () => {
  it("labels automatic language as following Obsidian", () => {
    expect(createTranslator("auto")("settings.language.auto")).toBe("Follow Obsidian");
    expect(createTranslator("zh-CN")("settings.language.auto")).toBe("跟随 Obsidian");
  });

  it("distinguishes table layout from cell-content alignment", () => {
    expect(createTranslator("en")("settings.layout.contentCenter")).toBe("Fit content — Center");
    expect(createTranslator("zh-CN")("settings.layout.pane")).toBe("铺满正文宽度");
  });

  it("localizes interchange commands and settings", () => {
    expect(createTranslator("en")("command.copyHtml")).toBe("Copy current table as HTML");
    expect(createTranslator("en")("modal.format.confirm")).toBe("Format table");
    expect(createTranslator("zh-CN")("modal.format.title")).toBe("格式化结构表格");
    expect(createTranslator("zh-CN")("settings.htmlPaste")).toBe("保留粘贴 HTML 表格的合并结构");
    expect(createTranslator("zh-CN")("menu.flattenAndPromoteBase")).toBe("展开结构并升级为 Base…");
  });

  it("explains complex-table export as an optional desktop workflow", () => {
    const en = createTranslator("en");
    const zh = createTranslator("zh-CN");
    expect(en("settings.exportGuide.body")).toContain("extra Markdown syntax");
    expect(en("settings.exportGuide.setup")).toContain("input extension");
    expect(zh("settings.exportGuide.setup")).toContain("输入扩展");
    expect(zh("settings.reading.desc")).toContain("合并单元格");
  });

  it("uses direct Base wording without internal promotion terminology", () => {
    expect(createTranslator("en")("command.createBaseRecord")).toBe("Create record for current Base");
    expect(createTranslator("en")("command.restorePromotedTable")).toBe("Restore table from current Base");
    expect(createTranslator("zh-CN")("command.createBaseRecord")).toBe("为当前 Base 新建记录");
    expect(createTranslator("zh-CN")("command.restorePromotedTable")).toBe("从当前 Base 恢复原表格");
  });

  it("localizes operation notices and count templates", () => {
    const t = createTranslator("zh-CN");
    expect(operationNotice(t, "merged")).toBe("已合并单元格。");
    expect(withCount(t("menu.setHeaderRows"), 3)).toBe("将前 3 行设为列标题");
  });

  it("states that HTML clipboard fallback flattens header structure and merged cells", () => {
    expect(createTranslator("en")("notice.copiedHtmlPlain")).toContain("Header structure and merged cells were flattened");
    expect(createTranslator("zh-CN")("notice.copiedHtmlPlain")).toContain("标题结构与合并单元格已展平");
  });
});
