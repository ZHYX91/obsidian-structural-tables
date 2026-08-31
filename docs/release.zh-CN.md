---
doc_id: release
language: zh-CN
source_language: zh-CN
translation_status: source
status: stable
last_synced: 2026-08-31
---

[English](release.en.md)

# Structural Tables — 发布流程

本文定义 Structural Tables 的可重复发布流程。源码、Candidate Bundle、真实 Obsidian 验收、
GitHub 发布与正式 Vault 部署是独立边界。

<!-- section: boundaries -->
## 边界

普通 tag push 不触发发布。commit、push、tag、workflow dispatch、GitHub Release 与正式 Vault
部署分别授权；任何本地门禁都不会产生远端写入。

<!-- section: version-source -->
## 版本与源码

`manifest.json`、`package.json`、`package-lock.json` 与 `versions.json` 必须绑定同一规范版本和精确
commit/tree。干净工作树必须通过 `npm run release:check`，同名 tag 只能不存在或已指向该提交。

<!-- section: candidate-bundle -->
## Candidate Bundle v3

vendored release-core `2.0.0` 与薄 adapter 创建唯一 Candidate Bundle v3，包含 `main.js`、
`manifest.json`、`styles.css`、`structural-tables-x.y.z.zip`、`SHA256SUMS` 与
`candidate-bundle.json`。版本 ZIP 使用 `structural-tables/` 根目录；Bundle 同时绑定工具链、
core/config/workflow、产品 payload、场景合同及 fixture 哈希。

<!-- section: product-acceptance -->
## 产品验收

同一 Bundle 必须通过桌面与 Android 模拟器验收，覆盖 Reading View 与 Live Preview 的 column
span、row span、多行 header、row-header boundary，preview-first format，以及非法源码保持与有界
诊断。Android 真机与 iOS 不在范围内。

<!-- section: standalone-workflow -->
## 独立工作流

生成并签入的 standalone workflow 只接受显式 `workflow_dispatch`。只读 verify job 在精确
commit 上执行一次独立安装与一次完整 `release:check`，重建并 source-verify Bundle；publish
job 下载固定 artifact 后只做 transport verification，不恢复 `dist`。

<!-- section: publication-verification -->
## 发布与核验

acceptance closure 不授权发布；单独 authorization 绑定同一 Bundle 与 closure。首次 mutation
前 workflow 深度验证记录、标签和只读 preflight。公共 Release 恰好包含三个 loose assets 与
版本 ZIP；`SHA256SUMS` 和 `candidate-bundle.json` 仅属于私有 Bundle。发布后回读托管字节与
provenance。

<!-- section: failure-deployment -->
## 失败、回退与部署

既有同 tag Release 只有完全一致时才是零写 no-op；任何差异都失败且不得覆盖，修复使用新版本。
正式 Vault 部署需对精确 Vault 单独授权并保留 `data.json`；候选、宿主、发布与部署分别报告。
