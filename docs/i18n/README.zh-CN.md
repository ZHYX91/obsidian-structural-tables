# Structural Tables

[English](../../README.md)

Structural Tables 在普通 Markdown 管道表格上增加合并单元格、多行列表头和行表头，同时保持源码可读、可迁移。

<!-- section: features -->
## 功能

- 使用内容严格等于 `<` 的单元格向左合并，使用 `^` 向上合并。
- 分隔行前连续的多行作为多行列表头。
- 在分隔行内部放置一个相邻的 `||`，标记行表头列。
- 在阅读视图和实时预览中渲染有语义、可访问的表格。
- 提供格式化、合并、拆分、插入和检查命令。
- 无效结构只提示，不改写笔记。

<!-- section: requirements-and-compatibility -->
## 要求与兼容性

首版要求 Obsidian 1.12.7 或更高版本。现阶段先开放桌面端；完成真机验收并留存记录后再开放移动端。Structural Tables 会解释结构表格中严格匹配的 `<`、`^` 与分隔行 `||`，因此不要让其他表格插件同时赋予这些记号不同含义。

<!-- section: installation -->
## 安装

在进入社区插件市场之前，可从 GitHub Release 下载 `main.js`、`manifest.json`、`styles.css`，放入 `.obsidian/plugins/structural-tables/`。重新加载 Obsidian，再在社区插件中启用 Structural Tables。

<!-- section: usage -->
## 用法

```markdown
| 地区 | 销售额 | < |
| 季度 | Q1 | Q2 |
| --- || --- | --- |
| 华北 | 10 | 12 |
| ^ | 8 | 11 |
```

分隔行之前、列数相同且连续的所有行都是列表头。`||` 只能在分隔行内部出现一次，不增加列数；它左侧的列为行表头。合并区域必须解析到同一个左上角内容单元格，构成完整矩形，并且不能跨越表头/数据角色边界。若要显示字面量记号，请写 `\<` 或 `\^`。

一旦出现任一结构特性，所有行都必须与分隔行严格等宽。无效结构保留原 Markdown 并显示诊断。“格式化当前结构表格”会输出规范形式：左上角保存内容，合并区域首行其余单元格使用 `<`，下方覆盖单元格使用 `^`。

<!-- section: settings -->
## 设置

设置页沿用 Obsidian 原生控件，分为“视图”和“外观”两个页签。可控制阅读视图、实时预览、诊断、适应内容/占满宽度、舒适/紧凑密度、交替行底色，以及自动/英文/简体中文界面语言。

<!-- section: limitations -->
## 局限

0.1 版不包含公式、单元格样式、块级或多行单元格内容、标题、编号和重复表头源码属性。导出与展开为普通 GFM 已列入后续计划，但不属于首版。解析器会主动拒绝有歧义或非矩形的合并。

<!-- section: privacy-and-security -->
## 隐私与安全

Structural Tables 完全在本地工作，不发起网络请求、不加载远程资源、不收集分析数据，也不会发送笔记内容。渲染不会改变 Markdown；只有用户主动执行命令时才会编辑，并会在替换前验证结果。

<!-- section: development -->
## 开发

使用 Node 24.18.0 与 npm 11.16.0。

```bash
npm ci
npm run check
```

仓库契约分别记录在[产品需求](../product-requirements.zh-CN.md)、
[交互规范](../ux-spec.zh-CN.md)、[架构说明](../architecture.zh-CN.md)、
[测试策略](../testing-strategy.zh-CN.md)与[发布指南](../release.zh-CN.md)中。另请参阅
[变更记录](../../CHANGELOG.md)、[贡献指南](../../CONTRIBUTING.md)与
[安全策略](../../SECURITY.md)。

<!-- section: support -->
## 支持

报告问题时请提供 Obsidian 版本、编辑模式、主题、相关表格 Markdown、预期结果和实际结果；分享示例前请移除笔记中的隐私内容。

<!-- section: license -->
## 许可证

[MIT](../../LICENSE)
