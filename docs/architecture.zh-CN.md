---
doc_id: architecture
language: zh-CN
source_language: zh-CN
translation_status: source
status: stable
last_synced: 2026-08-24
---

[English](architecture.en.md)

# 架构

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

一个共享 DOM 渲染器被阅读视图后处理器和 CodeMirror 组件调用。实时预览把块级装饰保存在 CodeMirror `StateField` 中，由独立的视图插件管理输入法组合输入和视图生命周期。结构表格组件增加单元格选区、行列把手和聚焦的文本编辑框，而不会把 CodeMirror 光标移入被替换范围。阅读视图既可映射 Obsidian 原生表格，也可映射行表头语法产生的精确源码块，并忽略递归渲染回调。单元格内容交给 Obsidian MarkdownRenderer，组件生命周期负责清理。

<!-- section: editing -->
## 编辑

命令和原位编辑先在纯内存所有权网格中产生候选源码，再重新解析验证。行列变换会重建矩形合并所有权、迁移仍存在的锚点，并拒绝内容丢失或无效边界；单元格输入先转义代码跨度外尚未转义的管道，再通过一次 CodeMirror 整表事务提交。序列化会保留笔记原有的 LF、CRLF 或 CR 换行符。

<!-- section: settings -->
## 设置

设置保存统一经过一个串行协调器；每个排队任务持有不可变快照，避免重叠修改让较早的保存请求错误写入后来的可变对象。

<!-- section: release -->
## 发布

锁定 Node、npm 与依赖版本；CI 运行统一检查；标签工作流传递精确构建产物、校验摘要并发布不可变 Release。
