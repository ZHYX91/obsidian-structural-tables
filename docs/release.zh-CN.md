---
doc_id: release
language: zh-CN
source_language: zh-CN
translation_status: source
status: stable
last_synced: 2026-08-26
---

[English](release.en.md)

# Structural Tables — 发布流程

<!-- section: versioning -->
## 版本

`package.json`、锁文件、`manifest.json`、`versions.json` 和标签版本必须一致；标签使用无前缀的 `x.y.z`。

<!-- section: gates -->
## 门禁

发布前运行运行时、格式、双语同步、静态检查、类型、覆盖率、生产构建与产物检查。`release:check` 还要求干净、已提交且标签一致的源码。

<!-- section: assets -->
## 产物

公开 Release 只包含 `main.js`、`manifest.json`、`styles.css` 与 `structural-tables-x.y.z.zip`。
压缩包内使用 `structural-tables/` 根目录。工作流交接额外包含 `SHA256SUMS`，但它不属于公共
Release 资产。

<!-- section: workflow -->
## 工作流

创建 tag 前，从当前远端默认分支 HEAD 手动运行只读 preflight 并输入计划版本；它要求远端 tag
与同版本 Release 尚不存在，运行完整门禁并生成手动安装 ZIP，但不发布。推送数值 tag 后，验证
任务构建一次并上传带摘要的精确交接产物；发布任务核验服务端身份、字节、摘要与证明后创建
不可变 Release。

失败的 tag workflow 可以安全重跑。既有同 tag Release 只有在稳定、不可变、精确包含四个公共
资产、与当前候选逐字节一致，且四项 provenance 均绑定同一 tag 与 commit 时，才作为成功
no-op 接受；任何差异都会失败，工作流不会覆盖、编辑或追加同 tag 资产。

<!-- section: acceptance -->
## 验收

源代码门禁、打包候选、临时 Vault、生产 Vault、模拟器和真机是独立声明。没有对应证据不得提升声明范围。

<!-- section: rollback -->
## 回退

已发布版本不可覆盖。发现问题时发布新补丁版本；生产 Vault 操作必须保留 `data.json`，且需要用户明确授权具体目标。
