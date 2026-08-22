---
doc_id: product-requirements
language: zh-CN
source_language: zh-CN
translation_status: source
status: stable
last_synced: 2026-08-22
---

[English](product-requirements.en.md)

# 产品需求

<!-- section: purpose -->
## 目标

让用户只用可读的 Markdown 管道表格表达合并单元格、多行列表头和行表头，并在 Obsidian 中获得可靠渲染与安全编辑。

<!-- section: syntax -->
## 语法契约

严格匹配的 `<` 向左合并，`^` 向上合并，`\<` 与 `\^` 表示字面量。分隔行之前连续且等宽的行均为列表头。分隔行内部最多一个无空格 `||`，其左侧为行表头列，且 `||` 不计入列数。

<!-- section: validity -->
## 有效性

结构表格所有行必须严格等宽。合并必须落到单一左上角内容锚点、形成完整矩形、不得越界，也不得跨越角表头、列表头、行表头和数据区域。无效时保留源码，不猜测、不自动修复。

<!-- section: capabilities -->
## 首版能力

阅读视图与实时预览渲染；插入、格式化、向左/向上合并、拆分和整篇检查命令；原生双语设置；明确诊断。格式化是显式命令，普通渲染不改源码。

<!-- section: exclusions -->
## 非目标

首版不包含公式、样式、块级/多行内容、标题编号、重复表头源码属性、HTML 导出和展开为普通 GFM。

<!-- section: success -->
## 验收标准

纯核心测试覆盖正例、反例和规范序列化；产物可复现且离线；真实 Obsidian 验收与自动化结论分开记录；真机验收前不声明移动端可用。
