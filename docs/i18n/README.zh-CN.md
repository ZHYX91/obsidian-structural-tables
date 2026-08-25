# Structural Tables

[English](../../README.md) · [简体中文](README.zh-CN.md)

Structural Tables 在普通 Markdown 管道表格上增加合并单元格、多行列表头和行表头，同时保持源码可读、可迁移。

## 界面截图

### 阅读视图

结构语义会渲染为清晰、可访问的表格，而笔记仍保持普通管道表格 Markdown。

![Structural Tables 在阅读视图中显示合并单元格、多行表头和行表头](../assets/structural-tables-reading-view-en.png)

### 实时预览

光标离开表格即可查看渲染结果；双击单元格即可原位编辑。

![Structural Tables 在实时预览中渲染表格](../assets/structural-tables-live-preview-en.png)

### 设置

阅读视图、实时预览和诊断分别提供说明清楚的独立开关。

<!-- section: features -->
## 功能

- 使用内容严格等于 `<` 的单元格向左合并，使用 `^` 向上合并。
- 分隔行前连续的多行作为多行列表头。
- 在分隔行内部放置一个相邻的 `||`，标记行表头列。
- 在阅读视图和实时预览中渲染有语义、可访问的表格。
- 支持原位编辑单元格，并自动转义粘贴的 Wiki 链接中的 `|`。
- 用把手选中整行或整列，再从右键菜单执行插入、删除、移动、对齐、合并、拆分或设置表头。
- 无效结构只提示，不改写笔记。

<!-- section: requirements-and-compatibility -->
## 要求与兼容性

Structural Tables 要求 Obsidian 1.12.7 或更高版本，且仅支持桌面版 Obsidian。它会解释结构表格中严格匹配的 `<`、`^` 与分隔行 `||`，因此不要让其他表格插件同时赋予这些记号不同含义。

<!-- section: installation -->
## 安装

打开**设置 → 第三方插件 → 浏览**，搜索 **Structural Tables**，安装并启用。手动安装时，从[最新版本](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest)下载 `structural-tables-<version>.zip`，解压到 `Vault/.obsidian/plugins/`。压缩包包含 `structural-tables/` 目录及其中的 `main.js`、`manifest.json` 和 `styles.css`。重新加载 Obsidian，再在第三方插件中启用 Structural Tables。

<!-- section: usage -->
## 用法

1. 在 Markdown 笔记中创建或粘贴一个普通管道表格；
2. 用严格匹配的 `<` 单元格向左合并，用严格匹配的 `^` 单元格向上合并，或在分隔行内部放置一个相邻的 `||`，把它左侧的列标记为行表头；
3. 在实时预览中把光标移出表格，或切换到阅读视图，即可查看渲染结果；
4. 双击已渲染的单元格，或选中后按 Enter/F2，可原位编辑；Enter 提交，Escape 取消，Tab 提交并前往下一格；
5. 使用行列把手或拖过多个单元格，再右键执行插入、安全删除、移动、对齐、合并、拆分或设置表头；
6. 打开命令面板可使用插入、格式化、检查和结构编辑操作。

```markdown
| 地区 | 销售额 | < |
| 季度 | Q1 | Q2 |
| --- || --- | --- |
| 华北 | 10 | 12 |
| ^ | 8 | 11 |
```

分隔行之前、列数相同且连续的所有行都是列表头。`||` 只能在分隔行内部出现一次，不增加列数；它左侧的列为行表头。合并区域必须解析到同一个左上角内容单元格，构成完整矩形，并且不能跨越表头/数据角色边界。若要显示字面量记号，请写 `\<` 或 `\^`。

一旦出现任一结构特性，所有行都必须与分隔行严格等宽。无效结构保留原 Markdown 并显示诊断。“格式化当前结构表格”会输出规范形式：左上角保存内容，合并区域首行其余单元格使用 `<`，下方覆盖单元格使用 `^`。

在实时预览中，普通 Markdown 表格完全沿用 Obsidian 原生编辑器。由于 Obsidian 原生控件无法表达跨行、跨列和多行表头，已渲染的结构表格提供自己的行列把手、单元格选区、原位编辑器和右键菜单。向结构单元格粘贴 `[[目标|别名]]` 或 `![[图片|尺寸]]` 时，会自动保存为表格安全的 `[[目标\|别名]]` 与 `![[图片\|尺寸]]`，且不会重复转义。会丢弃非空内容或破坏合并矩形的操作会被拒绝。

<!-- section: settings -->
## 设置

设置页沿用 Obsidian 原生控件，分为“常规”“视图”和“外观”三个页签。新安装默认使用“适应窗格宽度”，也可改为“适应内容宽度—靠左”或“适应内容宽度—居中”；还可控制阅读视图、实时预览、诊断、舒适/紧凑密度、交替行底色，以及跟随 Obsidian/英文/简体中文界面语言。

<!-- section: limitations -->
## 局限

Structural Tables 不支持公式、单元格样式、块级或多行单元格内容、标题、编号、重复表头源码属性、HTML 导出或展开为普通 GFM。解析器会主动拒绝有歧义或非矩形的合并。

<!-- section: privacy-and-security -->
## 隐私与安全

Structural Tables 完全在本地工作，不发起网络请求、不加载远程资源、不收集分析数据，也不会发送笔记内容。渲染不会改变 Markdown；原位编辑和菜单操作均由用户显式触发，并会在替换前验证结果。

<!-- section: development -->
## 开发

使用 Node 24.19.0 与 npm 11.17.0。

```bash
npm ci
npm run check
```

开发者参考文档：

- [产品需求](../product-requirements.zh-CN.md)
- [交互规范](../ux-spec.zh-CN.md)
- [架构说明](../architecture.zh-CN.md)
- [测试策略](../testing-strategy.zh-CN.md)
- [发布流程](../release.zh-CN.md)
- [变更日志](../../CHANGELOG.md)
- [贡献指南](../../CONTRIBUTING.md)
- [安全策略](../../SECURITY.md)

<!-- section: support -->
## 支持

- 工作流想法和一般反馈请发布到 [General](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/general)；
- 使用和配置问题请发布到 [Q&A](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/q-a)；
- 可复现缺陷和明确的功能建议请使用结构化的 [GitHub Issue 表单](https://github.com/ZHYX91/obsidian-structural-tables/issues/new/choose)，并提供 Obsidian 版本、编辑模式、主题、相关表格 Markdown、预期结果和实际结果；
- 安全漏洞只能通过 GitHub 的[私人漏洞报告](https://github.com/ZHYX91/obsidian-structural-tables/security/advisories/new)提交，详细要求见[安全策略](https://github.com/ZHYX91/obsidian-structural-tables/security/policy)。

不要在公开页面发布真实的 Vault 路径、笔记内容、凭据或个人信息。

<!-- section: license -->
## 许可证

[MIT](../../LICENSE) © ZhengYX
