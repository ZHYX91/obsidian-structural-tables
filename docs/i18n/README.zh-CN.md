# Structural Tables

[English](../../README.md) · [简体中文](README.zh-CN.md)

Structural Tables 在普通 Markdown 管道表格上增加合并单元格、多行列标题、行标题和无列标题表格。Markdown 仍然保持可读，仅仅查看表格不会改写笔记。

表格可以放在引用、Callout 和列表续行中；编辑或格式化后仍会留在原来的位置。只有在转换为 Obsidian Base 前，才需要先把嵌套表格移到顶层。

## 界面截图

### 阅读视图中的三线表

用多行列表头组织分组列，用跨行合并的行表头归类相关记录。三线表在列分组下方增加短分组线，同时保持表体简洁。

![阅读视图中的三线表，包含分组列表头和按地区合并的行表头](../assets/structural-tables-reading-view-en.png)

### 实时预览

在实时预览中直接编辑单元格，合并表头始终保持可见。这里为同一张表选用了网格样式；桌面端单击单元格、触屏上双击单元格即可原位编辑。

![在实时预览中编辑营收单元格，网格表保留合并表头](../assets/structural-tables-live-preview-en.png)

### 外观设置

独立选择“跟随主题”“网格表”或“三线表”，并按需调整表格布局和密度。“常规”“视图”和“外观”三个页签让设置保持清晰。

![外观设置中的三线表样式、布局、密度和交替行底色选项](../assets/structural-tables-settings-en.png)

<!-- section: features -->
## 功能

- 用内容严格等于 `<` 或 `^` 的单元格合并左侧或上方单元格。
- 支持多行列标题、用 `||` 标记左侧行标题列，以及完全没有列标题的表格。
- 在阅读视图和实时预览中显示相同的合并结构。
- 在实时预览中直接编辑单元格，并可增删、移动、对齐行列，合并或拆分选区，以及在不删除文字的情况下改变标题角色。
- 从浏览器、Excel 和 Google Sheets 粘贴受支持的 HTML 表格，并保留跨行、跨列结构。
- 将表格复制为 HTML、普通 GFM、TSV 或 CSV。
- 可选让 Structural Tables 编辑普通 GFM 表格；关闭该设置后立即恢复 Obsidian 原来的表格界面，Markdown 不会因此改变。
- 将表格转换为 Obsidian Base，并在确认前查看生成的记录笔记和属性映射。记录移动或重命名后仍会继续出现在原来的 Base 中。
- 对可能丢失非空内容或隐藏源码的操作直接拒绝；结构语法有误时显示诊断，而不是静默改写笔记。

<!-- section: requirements-and-compatibility -->
## 要求与兼容性

Structural Tables 要求 Obsidian 1.12.7 或更高版本，支持桌面版 Obsidian 和 Android。将表格转换为 Base 还需要启用 Obsidian 核心插件 Bases。

在 Structural Table 中，严格匹配的 `<`、`^` 和分隔行里的 `||` 有特殊含义。如果检测到其他已启用的表格插件也使用这些记号，Structural Tables 会提示一次可能的冲突。

<!-- section: installation -->
## 安装

可从 Obsidian 第三方插件目录安装 Structural Tables：打开**设置 → 第三方插件 → 浏览**，搜索 **Structural Tables**，点击**安装**，然后启用插件。

如需手动安装，请从[最新版本](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest)下载 `structural-tables-<version>.zip`，解压到 `Vault/.obsidian/plugins/`。压缩包包含 `structural-tables/` 目录及其中的 `main.js`、`manifest.json` 和 `styles.css`。重新加载 Obsidian，再在第三方插件中启用 Structural Tables。

<!-- section: usage -->
## 用法

1. 先创建或粘贴一张普通 Markdown 管道表格。
2. 在单元格中写 `<` 可与左侧单元格合并，写 `^` 可与上方单元格合并。
3. 在分隔行中放置一个相邻的 `||`，可把它左侧的列标记为行标题。
4. 在实时预览中把源码光标移出表格，或切换到阅读视图，即可看到渲染结果。
5. 在实时预览中，桌面端单击、触屏端双击单元格即可编辑。Enter 保存，Escape 取消，Shift+Enter 插入视觉换行，Tab 移到下一个可见单元格。
6. 使用表格边缘的 **+** 和行列把手，可以增删、选择、移动、对齐、合并、拆分或改变标题角色。会丢失内容或拆散合并区域的操作会被拒绝。
7. 格式化、复制、HTML 表格导入、Sheets Extended 迁移和转换为 Base 等功能可从命令面板或表格右键菜单使用。

阅读视图只负责显示；原位编辑和表格控件位于实时预览中。

### 表格语法

一张结构表格可以同时使用多行列标题和行标题：

```markdown
| 地区 | 销售额 | <   |
| 季度 | Q1     | Q2  |
| ---  || ---   | --- |
| 华北 | 10     | 12  |
| ^    | 8      | 11  |
```

分隔行正上方连续的表格行会作为列标题。`||` 不会增加列数，只是把它左侧的列标记为行标题。

分隔行也可以直接放在第一行，这样表格就没有列标题：

```markdown
| --- | --- |
| Alice | 10 |
| Bob   | 20 |
```

选中完整的列标题区域后选择**取消列标题**，文字会保留，只是这些行改为普通数据。以后也可以重新选中表格顶部的连续行，把它们设为列标题。

合并标记必须形成一个完整矩形，并且不能跨越标题区和数据区。若要在单元格中显示字面量 `<` 或 `^`，请写成 `\<` 或 `\^`。

### 编辑、换行和公式

Shift+Enter、单元格右键菜单和多行粘贴都可以插入视觉换行。普通文字保存时使用统一的 `<br>`；如果原文已经手写成 `<br>`、`<br/>` 或 `<br />`，仅格式化表格时会保留原来的写法。

可以安全保存的单行 TeX 公式会原样保留。像 `$|x|$`、`$P(A|B)$` 这样的裸竖线在 Markdown 表格里有歧义，因此插件不会擅自保存，而是保留草稿。对于这两种简单情况，单元格菜单可以明确改写成 `\lvert … \rvert` 或 `\mid`；更复杂的公式需要手动修改。

### 普通 GFM 表格

普通 Markdown 表格默认仍使用 Obsidian 自带的编辑界面。开启**接管普通 Markdown 表格**后，也可以使用 Structural Tables 的实时预览控件；关闭设置即可立即恢复 Obsidian 原来的界面。

GFM 允许数据行比表头少列或多列。缺少的单元格会显示为空；如果某一行含有 Obsidian 不会显示的额外源码单元格，插件仍可显示这张表，但会禁止通过 Structural Tables 改写它，避免误删隐藏内容。

### 粘贴和复制

开启**保留粘贴 HTML 表格的合并结构**后，可以转换受支持的多列 HTML 表格，并保留跨行、跨列和视觉换行。无法安全转换的 HTML 会交还 Obsidian 处理；只有在明确安全时，才会使用剪贴板中的完整纯文本版本。

只有正文 `td` 的 HTML 表格会保持无列标题，不会擅自把第一行当作标题。来源中真正存在的 `thead`/`th` 会按其语义导入。

要粘贴到 Word 等应用，可使用**复制整张表格用于 Word / HTML**或**将当前表格复制为 HTML**。也可以复制为普通 GFM、TSV 或 CSV。由于 GFM 本身要求存在标题行，把无列标题表格转换成普通 GFM 时会加入一行空标题作为兼容处理。

### 转换为 Base

转换前请先保存笔记；如果表格位于引用、Callout 或列表中，请先把它移到顶层。预览会显示目标文件夹、准备生成的记录笔记、属性名称，以及哪些表格结构会在转换时展开。

新记录默认创建在 `<原笔记所在文件夹>/_structural-table-records/<table-id>/`。这里仅是默认创建位置：之后移动或重命名记录笔记，并不会让它离开原来的 Base。`structural-tables` 列表属性负责保存这种关联。

如果转换在创建了一部分文件后失败，插件会保留这些文件并报告所在文件夹，方便检查处理。**从当前已转换 Base 恢复表格**会从 `_promotion.json` 恢复转换前的表格快照，但不会删除已经生成的记录笔记。

空标题会使用 `column_n`；非空标题（包括纯数字和带前导零的名称）会尽量直接作为属性名。重名或保留名称会追加数字后缀。

### 恢复被中断的编辑

单元格修改被拒绝时，编辑框会尽量保持打开。如果外部修改或视图重建打断了尚未保存的草稿，Structural Tables 会在当前会话中保留一份恢复副本。使用**恢复被中断的单元格草稿**可以重新打开恢复窗口。Obsidian 或插件重启后这些副本会消失，因此重要内容应先复制出来。

<!-- section: settings -->
## 设置

设置页分为**常规**、**视图**和**外观**三个页签。

- **常规**：语言、HTML 表格粘贴转换和插件冲突提示。
- **视图**：阅读视图、实时预览、诊断，以及默认关闭的**接管普通 Markdown 表格**。
- **外观**：跟随主题、网格表或三线表；表格宽度和位置；舒适或紧凑间距；可选的交替行底色。

**跟随主题**把表头颜色和字重交给当前 Obsidian 主题。**网格表**会为列标题和行标题使用一致的轻度标题底色。**三线表**只保留顶线、底线和列标题区域下方的一条横线，不增加正文竖线；没有列标题时自然只剩顶线和底线。

外观设置只影响显示，不会修改 Markdown。

<!-- section: limitations -->
## 局限

Structural Tables 不是电子表格计算引擎，不会计算公式。它也不支持每个单元格单独设置样式、表格标题和编号、单元格内的块级 Markdown，或真正的多行 Markdown 单元格。

导入 HTML 时，单元格内容会转换为纯文本和受支持的 `<br>` 视觉换行，不会把复杂富文本自动翻译成 Markdown。转换为 Base 时，表格布局会变成普通属性：多行列标题用 ` / ` 连接，行标题变成普通属性，合并的行标题值会写入它覆盖的各条记录。数据区存在合并单元格时，必须先拆分后才能转换。

从 Base 恢复表格需要生成的 `_promotion.json` 仍位于 Base 代码块记录的路径。

<!-- section: privacy-and-security -->
## 隐私与安全

Structural Tables 在本地处理表格，本身不增加联网或数据分析。单元格内容仍由 Obsidian 渲染，因此笔记中的远程图片或嵌入内容会继续遵循 Obsidian 自己的网络行为。

仅仅查看表格不会修改 Markdown。编辑和菜单命令都需要用户主动触发，并会在替换源码前检查结果。转换为 Base 只会创建预览中列出的本地文件；如果中途失败，已经创建的文件会保留下来供检查，而不会自动删除。

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
- [变更日志](../../CHANGELOG.md)
- [贡献指南](../../CONTRIBUTING.md)
- [安全策略](../../SECURITY.md)

<!-- section: support -->
## 支持

- [Q&A](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/q-a)：使用和配置问题。
- [Ideas](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/ideas)：尚待讨论的功能与工作流想法。
- [Show and tell](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/show-and-tell)：技巧、工作流和参考实现。
- 可复现缺陷和明确的功能建议请使用 [GitHub Issues](https://github.com/ZHYX91/obsidian-structural-tables/issues/new/choose)，并提供 Obsidian 版本、编辑模式、主题、相关表格 Markdown、预期结果和实际结果；
- 安全漏洞只能通过 GitHub 的[私人漏洞报告](https://github.com/ZHYX91/obsidian-structural-tables/security/advisories/new)提交，详细要求见[安全策略](https://github.com/ZHYX91/obsidian-structural-tables/security/policy)。

不要在公开页面发布真实的 Vault 路径、笔记内容、凭据或个人信息。

<!-- section: license -->
## 许可证

[MIT](../../LICENSE) © ZhengYX
