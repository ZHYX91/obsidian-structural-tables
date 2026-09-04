---
doc_id: architecture
language: zh-CN
source_language: zh-CN
translation_status: source
status: stable
last_synced: 2026-08-28
---

[English](architecture.en.md)

# Structural Tables — 架构

<!-- section: boundaries -->
## 边界

`src/core` 是无宿主依赖的纯 TypeScript；配置、渲染、编辑器、阅读视图与应用接线分层。公共仓库不依赖其他仓库或本地 Vault。

<!-- section: parser -->
## 解析

解析器扫描至少包含三个连字符的 GFM 候选分隔行，跳过带 BOM 且由 `---` 或 `...` 结束的 frontmatter、围栏代码和缩进代码，识别转义管道与代码跨度，输出源码范围、角色网格、合并锚点和诊断。

<!-- section: validation -->
## 验证

合并只向左或向上解析，因此不会形成方向环。验证再检查锚点、角色边界和矩形闭包；结构模式启用后执行严格列数检查。

<!-- section: rendering -->
## 渲染

一个共享 DOM 渲染器被阅读视图后处理器和 CodeMirror 组件调用。实时预览把块级装饰保存在 CodeMirror `StateField` 中，由独立的视图插件管理输入法组合输入和视图生命周期。结构表格始终进入该路径；普通 GFM 仅在启用可选接管设置时进入。设置刷新会重建编辑器装饰和阅读视图，但不改变源码。每个可见锚点单元格按行列跨度携带块末端与行内末端标记，CSS 依照真实网格位置而非 DOM 子元素位置移除内边框；交替行底色位于透明数据单元格下方，可穿过跨行单元格。插件接管的表格组件增加单元格选区、行列把手、每组一个的游动 Tab 停靠点和聚焦的文本编辑框，而不会把 CodeMirror 光标移入被替换范围。鼠标指针由插件接管拖动选区；触摸指针使用两次点选的范围状态，并刻意保留宿主对首次指针事件的处理，以支持滚动和长按。阅读视图既可映射 Obsidian 原生表格，也可映射行表头语法产生的精确源码块，并忽略递归渲染回调。单元格内容交给 Obsidian MarkdownRenderer，组件生命周期负责清理。

<!-- section: editing -->
## 编辑

命令和原位编辑先在纯内存所有权网格中产生候选源码，再重新解析验证。行列变换会重建矩形合并所有权、迁移仍存在的锚点，并拒绝内容丢失或无效边界；单元格输入先转义代码跨度外尚未转义的管道，再通过一次 CodeMirror 整表事务提交。序列化会保留笔记原有的 LF、CRLF 或 CR 换行符。

<!-- section: interchange -->
## 互操作

纯核心投影把有效结构表格展开为稳定的列路径和二维数据。GFM、TSV、CSV 与后续记录迁移共用该投影；语义 HTML 直接使用验证后的 rowspan、colspan、角色和 scope。剪贴板接线只负责把 HTML DOM 归一化成单元格、跨度和 th/td 角色，再交给纯核心生成并重新解析结构 Markdown。Sheets Extended 迁移只接受唯一、非边缘且整列严格为 `-` 的伪分隔列。

<!-- section: base-promotion -->
## Base 提升

纯核心从共享表格投影生成稳定且唯一的 Property key、记录值、文件名候选、列表型 `structural-tables` 成员资格和嵌入式 Base 源码。新提升保留所有去除首尾空白后的非空列路径作为 Property key，只有整列空表头使用 `column_n`；规范化重名或控制字段冲突通过数字后缀解决，Base 属性统一使用方括号引用。Metadata 读取器同时接受新引用和旧点号引用，因此不会迁移已有提升结果。列表头合并被展平为列路径，行表头合并值按记录重复；数据区域合并必须先拆分。应用层为每次提升分配独立的表格目录和 ID，先创建全部记录与 `_promotion.json`，再重新解析未变化的源表并执行一次编辑器替换。记录不使用插件身份属性。任何创建或快照失败都会把本次独立目录交给 Obsidian 废纸篓。

恢复清单记录原表、生成 Base、源文件和初始记录路径。恢复只替换当前匹配 ID 的插件 Base，不删除记录。成员资格不查询路径，因此记录重命名或移动无需事件监听。插件的新建记录命令根据当前宿主笔记目录计算收件箱；宿主移动不触碰已有记录。运行时同时读取 `structural-tables` 和旧版 `structural_table_ids`；双字段等价时接受，无效或冲突时停止处理。显式的全库迁移先预览受影响文件并检查过期状态，再更新旧成员字段与 Base 过滤条件，可选择移除 `structural_record_id`；后续写入失败时恢复已经完成的文件。

<!-- section: settings -->
## 设置

持久化设置使用 schema 1 envelope。此前的无版本对象是唯一旧格式：启动时只规范化一次并排队写入 schema 1 envelope；当前 schema 1 数据不会重复迁移。任何显式未知或畸形 schema 都进入不兼容只读状态，当前插件版本绝不覆盖未来字段。设置保存统一经过一个串行协调器；每个排队任务持有不可变快照，失败保持可见且可重试，卸载时等待队列并对最后一个失败快照再重试一次。

<!-- section: release -->
## 发布

锁定 Node、npm 与依赖版本；CI 运行统一检查；标签工作流传递精确构建产物、校验摘要并发布不可变 Release。
