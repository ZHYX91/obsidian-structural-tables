---
doc_id: ux-spec
language: zh-CN
source_language: zh-CN
translation_status: source
status: stable
last_synced: 2026-08-23
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

<!-- section: table-selection -->
## 表格选区与右键菜单

沿用 Obsidian 原生 Markdown 表格的单元格选区、整行/整列把手和编辑器右键菜单，不增加同时可见的第二套把手。矩形多单元格选区提供“合并所选单元格”；单个合并单元格提供“拆分合并单元格”。除左上角外存在内容、选区跨角色边界或只包含已有合并区域的一部分时，拒绝合并并保留源码。

从表格顶部开始的完整行选区可以设置列标题行；从最左侧开始且覆盖所有表格行的完整列选区可以设置或取消行标题列。改变边界会使合并跨越角色区域时拒绝操作。拖动 Obsidian 原生把手仍用于重新排列行列。

<!-- section: diagnostics -->
## 诊断

无效结构显示红色边缘和可读原因；不替换阅读视图中的原表格，也不在编辑器中隐藏源码。

<!-- section: settings -->
## 设置

使用 Obsidian 原生设置控件和顶部分页，分为“常规”“视图”“外观”。语言位于第一个“常规”页，自动语言显示为“跟随 Obsidian”并附带说明；控件标签与说明支持英文和简体中文。
