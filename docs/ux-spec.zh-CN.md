---
doc_id: ux-spec
language: zh-CN
source_language: zh-CN
translation_status: source
status: stable
last_synced: 2026-08-22
---

[English](ux-spec.en.md)

# 交互规范

<!-- section: principles -->
## 原则

源码始终可见、可恢复；渲染负责理解而非改写；可能丢失内容的操作必须拒绝。

<!-- section: live-preview -->
## 实时预览

光标或选区位于表格外时显示语义表格；进入表格立即显示原 Markdown，便于编辑。输入法合成期间不切换渲染。

<!-- section: reading-view -->
## 阅读视图

用 `thead`、`tbody`、`th`、`td`、`rowspan`、`colspan` 与合适的 `scope` 渲染。单元格内部继续使用 Obsidian Markdown 渲染。

<!-- section: commands -->
## 命令

插入模板、格式化、向左合并、向上合并、拆分和检查均可从命令面板调用。非空单元格合并时显示说明并保持原文。

<!-- section: diagnostics -->
## 诊断

无效结构显示红色边缘和可读原因；不替换阅读视图中的原表格，也不在编辑器中隐藏源码。

<!-- section: settings -->
## 设置

使用 Obsidian 原生设置控件和顶部分页，分为“视图”“外观”。控件标签与说明均支持自动、英文和简体中文。
