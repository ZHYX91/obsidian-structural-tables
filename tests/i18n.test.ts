// @vitest-environment happy-dom

import * as host from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyInterfaceLocale, createTranslator, operationNotice, TRANSLATIONS, withCount } from "../src/config/i18n";
import { LOCALES, resolveLocale, sanitizeInterfaceLanguage } from "../src/config/locale";

afterEach(() => vi.restoreAllMocks());

describe("i18n", () => {
  it.each([
    ["en-GB", "en"], ["zh", "zh-CN"], ["zh-CN", "zh-CN"], ["zh-SG", "zh-CN"],
    ["zh-TW", "zh-TW"], ["zh-HK", "zh-TW"], ["zh-MO", "zh-TW"], ["zh_Hant_HK", "zh-TW"],
    ["zh-Hans-HK", "zh-CN"], ["ja-JP", "ja"], ["de-AT", "de"], ["es-419", "es"], ["ar-SA", "ar"],
    ["", "en"], ["fr", "en"], ["arbitrary", "en"],
  ] as const)("resolves Obsidian %s to %s", (input, expected) => {
    vi.spyOn(host, "getLanguage").mockReturnValue(input);
    expect(resolveLocale("auto", input)).toBe(expected);
    expect(createTranslator("auto").locale).toBe(expected);
    expect(createTranslator("auto")("transpose.confirmTitle")).toBe(createTranslator(expected)("transpose.confirmTitle"));
    expect(resolveLocale("en", input)).toBe("en");
  });

  it("keeps every catalog complete with the same placeholders", () => {
    const keys = Object.keys(TRANSLATIONS.en).sort();
    const placeholders = (text: string): string[] => [...text.matchAll(/\{[a-zA-Z]+\}/gu)].map((match) => match[0]).sort();
    expect(Object.keys(TRANSLATIONS).sort()).toEqual(LOCALES.map((locale) => locale.id).sort());
    for (const catalog of Object.values(TRANSLATIONS)) {
      expect(Object.keys(catalog).sort()).toEqual(keys);
      for (const key of keys as Array<keyof typeof TRANSLATIONS.en>) {
        expect(catalog[key].trim(), key).not.toBe("");
        expect(placeholders(catalog[key]), key).toEqual(placeholders(TRANSLATIONS.en[key]));
      }
    }
  });

  it("accepts saved supported IDs and safely resets unrecognized settings to automatic", () => {
    for (const locale of LOCALES) expect(sanitizeInterfaceLanguage(locale.id)).toBe(locale.id);
    for (const value of ["auto", undefined, null, {}, "ar-SA", "fr", "zh"]) expect(sanitizeInterfaceLanguage(value)).toBe("auto");
  });

  it("localizes the interface independently of table direction and isolates RTL substitutions", () => {
    const note = document.createElement("div"); note.dir = "ltr";
    const table = note.appendChild(document.createElement("table")); table.textContent = "مرحبا ABC";
    const surface = document.createElement("div");
    applyInterfaceLocale(surface, createTranslator("ar"));
    expect(surface.getAttribute("lang")).toBe("ar"); expect(surface.getAttribute("dir")).toBe("rtl");
    expect(note.dir).toBe("ltr"); expect(table.hasAttribute("dir")).toBe(false);
    const path = "Folder/تقرير-ABC.md";
    expect(createTranslator("ar")("image.saved").replace("{path}", path)).toContain(`\u2068${path}\u2069`);
    applyInterfaceLocale(surface, createTranslator("en")); expect(surface.getAttribute("dir")).toBe("ltr");
    applyInterfaceLocale(surface, (key) => key); expect(surface.getAttribute("lang")).toBe("en");
  });

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
