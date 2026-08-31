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

<!-- section: versioning -->
## 版本

`package.json`、锁文件、`manifest.json`、`versions.json` 和标签版本必须一致；标签使用无前缀的 `x.y.z`。

<!-- section: gates -->
## 门禁

普通 `check` 运行 runtime、格式、双语同步、静态检查、类型、覆盖率、production build、
产品 bundle 检查和公共 vendored-core 校验；`release:check` 额外运行 tag-aware 校验。准备
候选时允许同版本 tag 不存在，但既有 tag 必须指向 `HEAD`。

<!-- section: assets -->
## 产物

公开 Release 只包含 `main.js`、`manifest.json`、`styles.css` 与 `structural-tables-x.y.z.zip`。
压缩包内使用 `structural-tables/` 根目录。工作流交接额外包含 `candidate.json` 与
`SHA256SUMS`，二者都不属于公共 Release 资产。

<!-- section: workflow -->
## 工作流

构建一次确定性 core candidate，完成隔离验收，并把 workspace candidate envelope、closure 与
明确 authorization 保持为三份独立证据。创建和推送精确数值 tag 需要另行授权，且永远不会
触发发布。

手动 workflow 默认只读 `verify`。Workspace 只有在提供精确 candidate commit、candidate /
envelope / closure / authorization 摘要，以及原始 closure 与 authorization 字节时，才派发
`publish`。verify 任务重建并上传唯一固定 handoff；写权限任务校验两份传输证据与 core
publication boundary，并在任何写入前只读预检 GitHub。Release 不存在才允许暂存、签发
provenance 和创建；既有 Release 只有字节与 provenance 全部精确通过时才作为零写入安全重跑，
任何冲突都在这些写入前失败，且 `publish-github` 会重复检查。独立 post-verification 任务校验
hosted bytes、元数据、tag 身份与 provenance。

既有同 tag Release 只有全部精确检查通过时才按成功 no-op 接受；任何差异都会失败，workflow
不会覆盖、编辑或追加同 tag 资产。

<!-- section: acceptance -->
## 验收

源代码门禁、打包候选、临时 Vault、生产 Vault 和 Android 模拟器是独立声明。Android 真机和 iOS 不在范围内；没有对应证据不得提升受支持声明。

<!-- section: rollback -->
## 回退

已发布版本不可覆盖。发现问题时发布新补丁版本；生产 Vault 操作必须保留 `data.json`，且需要用户明确授权具体目标。
