import { getLanguage } from "obsidian";

import type { InterfaceLanguage } from "./settings";

const en = {
  "command.format": "Format current structural table",
  "command.insert": "Insert structural table",
  "command.mergeLeft": "Merge current cell left",
  "command.mergeUp": "Merge current cell up",
  "command.split": "Split current merged cell",
  "command.validate": "Validate structural tables in current note",
  "notice.formatted": "Structural table formatted.",
  "notice.inserted": "Structural table inserted.",
  "notice.noTable": "Place the cursor inside a structural table.",
  "notice.valid": "All structural tables are valid.",
  "settings.appearance": "Appearance",
  "settings.behavior": "Views",
  "settings.density": "Table density",
  "settings.density.desc": "Choose the vertical spacing used by rendered tables.",
  "settings.density.comfortable": "Comfortable",
  "settings.density.compact": "Compact",
  "settings.diagnostics": "Show diagnostics",
  "settings.diagnostics.desc": "Mark invalid structural tables without changing their Markdown.",
  "settings.language": "Interface language",
  "settings.language.auto": "Automatic",
  "settings.language.en": "English",
  "settings.language.zh": "简体中文",
  "settings.live": "Live Preview",
  "settings.live.desc": "Render valid structural tables while the cursor is outside them.",
  "settings.reading": "Reading view",
  "settings.reading.desc": "Render structural table semantics in Reading view.",
  "settings.title": "Structural Tables",
  "settings.width": "Table width",
  "settings.width.content": "Fit content",
  "settings.width.full": "Full width",
  "settings.zebra": "Alternating rows",
  "settings.zebra.desc": "Use a subtle alternating background for body rows.",
} as const;

type TranslationKey = keyof typeof en;
const zh: Record<TranslationKey, string> = {
  "command.format": "格式化当前结构表格",
  "command.insert": "插入结构表格",
  "command.mergeLeft": "向左合并当前单元格",
  "command.mergeUp": "向上合并当前单元格",
  "command.split": "拆分当前合并单元格",
  "command.validate": "检查当前笔记中的结构表格",
  "notice.formatted": "结构表格已格式化。",
  "notice.inserted": "已插入结构表格。",
  "notice.noTable": "请将光标放在结构表格内。",
  "notice.valid": "所有结构表格均有效。",
  "settings.appearance": "外观",
  "settings.behavior": "视图",
  "settings.density": "表格密度",
  "settings.density.desc": "选择渲染表格的纵向间距。",
  "settings.density.comfortable": "舒适",
  "settings.density.compact": "紧凑",
  "settings.diagnostics": "显示诊断",
  "settings.diagnostics.desc": "标记无效结构表格，但不改动 Markdown。",
  "settings.language": "界面语言",
  "settings.language.auto": "自动",
  "settings.language.en": "English",
  "settings.language.zh": "简体中文",
  "settings.live": "实时预览",
  "settings.live.desc": "光标位于表格外时渲染有效的结构表格。",
  "settings.reading": "阅读视图",
  "settings.reading.desc": "在阅读视图中渲染结构表格语义。",
  "settings.title": "Structural Tables",
  "settings.width": "表格宽度",
  "settings.width.content": "适应内容",
  "settings.width.full": "占满宽度",
  "settings.zebra": "交替行底色",
  "settings.zebra.desc": "为表体行使用轻微的交替背景。",
};

export type Translate = (key: TranslationKey) => string;

export function createTranslator(language: InterfaceLanguage): Translate {
  const selected = language === "auto" ? (getLanguage().toLowerCase().startsWith("zh") ? zh : en) : language === "zh-CN" ? zh : en;
  return (key) => selected[key];
}
