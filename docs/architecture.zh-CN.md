---
doc_id: architecture
language: zh-CN
source_language: zh-CN
translation_status: source
status: stable
last_synced: 2026-08-22
---

[English](architecture.en.md)

# 架构

<!-- section: boundaries -->
## 边界

`src/core` 是无宿主依赖的纯 TypeScript；配置、渲染、编辑器、阅读视图与应用接线分层。公共仓库不依赖其他仓库或本地 Vault。

<!-- section: parser -->
## 解析

解析器扫描候选分隔行，跳过 frontmatter、围栏代码和缩进代码，识别转义管道与代码跨度，输出源码范围、角色网格、合并锚点和诊断。

<!-- section: validation -->
## 验证

合并只向左或向上解析，因此不会形成方向环。验证再检查锚点、角色边界和矩形闭包；结构模式启用后执行严格列数检查。

<!-- section: rendering -->
## 渲染

一个共享 DOM 渲染器被阅读视图后处理器和 CodeMirror 组件调用。单元格内容交给 Obsidian MarkdownRenderer，组件生命周期负责清理。

<!-- section: editing -->
## 编辑

命令先在内存网格中产生候选源码，再重新解析验证；只有结果有效且无内容丢失时才替换当前表格范围。

<!-- section: release -->
## 发布

锁定 Node、npm 与依赖版本；CI 运行统一检查；标签工作流传递精确构建产物、校验摘要并发布不可变 Release。
