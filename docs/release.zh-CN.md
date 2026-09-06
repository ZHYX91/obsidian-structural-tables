---
doc_id: release
language: zh-CN
source_language: zh-CN
translation_status: source
status: stable
last_synced: 2026-09-06
---

[English](release.en.md)

# Structural Tables — 发布流程

本文定义 Structural Tables 的可重复发布流程。源码、Candidate Bundle、真实 Obsidian 验收、
GitHub 发布与正式 Vault 部署是独立边界。

<!-- section: boundaries -->
## 边界

获授权的稳定版本 tag push 触发发布。也可在同一 tag 上手动派发，选择只验证或发布，两种入口共用工作流。宿主验收可选；发布不会部署到 Vault。

<!-- section: version-source -->
## 版本与源码

`manifest.json`、`package.json`、`package-lock.json` 与 `versions.json` 绑定同一版本。CI 检出事件的精确提交，检查 tag 和默认分支包含关系，安装锁定依赖，并执行一次 `npm run release:check`。

<!-- section: candidate-bundle -->
## Candidate Bundle

仓库内固定的 release-core 与薄适配器生成确定性的 Candidate Bundle，包含 `main.js`、`manifest.json`、`styles.css`、`structural-tables-x.y.z.zip`、`SHA256SUMS` 和 `candidate-bundle.json`。ZIP 中只有一个 `structural-tables/` 目录，文件与松散资产一致。Bundle 同时绑定源码、工具链、构建配置、工作流和验收 fixture。

<!-- section: product-acceptance -->
## 可选产品验收

按照 `docs/ACCEPTANCE.md` 选择快速检查、针对性回归或完整回归。记录精确候选、宿主和主题版本、选择范围及实际结果。缺失、跳过、未完成或失败的宿主检查不阻止明确获授权的发布，也不能改记为通过。Android 实体设备和 iOS 不在验收范围内。

<!-- section: standalone-workflow -->
## 独立工作流

tag push 与手动派发共用构建、发布和发布后验证任务。只读构建任务生成并验证 Bundle；发布任务下载同一固定资产，不重复构建，在写入前验证事件、tag、提交和 Bundle 摘要。手动 verify 模式不执行发布。

<!-- section: publication-verification -->
## 发布与验证

Actions 为四个公开资产生成 SLSA 构建证明。发布器核对其源码、tag 和工作流，创建草稿，下载并检查全部草稿资产，然后正式发布 immutable Release。独立任务再检查已发布资产。公开附件仅为三个松散文件和版本 ZIP；Bundle 元数据保留在 CI artifact 中。GitHub 发布结果与 Community Directory 审核结果分别记录。

<!-- section: failure-deployment -->
## 失败与部署

精确匹配的既有 immutable Release 验证后不再写入。绑定同一 Bundle 的完整草稿可继续发布；冲突或不完整资产会停止，不覆盖原内容，重试前需检查失败操作。验证失败不自动删除或重打标签；删除过的 immutable 标签名称不能复用。Vault 部署需要单独授权，并保留 `data.json`。
