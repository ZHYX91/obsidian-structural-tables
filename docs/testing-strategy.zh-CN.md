---
doc_id: testing-strategy
language: zh-CN
source_language: zh-CN
translation_status: source
status: stable
last_synced: 2026-08-22
---

[English](testing-strategy.en.md)

# 测试策略

<!-- section: levels -->
## 层级

测试分为纯核心单元测试、DOM 渲染测试、插件接线测试、打包候选检查和真实 Obsidian 验收，各层结论不得互相替代。

<!-- section: parser-cases -->
## 解析用例

覆盖普通 GFM 不接管、左右/上下合并、多行表头、行表头、转义记号、管道转义、代码跨度、代码块与 frontmatter。

<!-- section: invalid-cases -->
## 反例

覆盖缺失锚点、非矩形、跨角色、边缘/多重/带空格 `||`、宽度不一致；断言源码不被修改且诊断稳定。

<!-- section: commands -->
## 命令

覆盖安全合并、非空拒绝、拆分与规范格式化；每次候选编辑必须经过重新解析。

<!-- section: host -->
## 宿主验收

在明确命名的临时 Vault 中测试最低和当前 Obsidian、亮暗主题、实时预览光标切换、阅读视图、设置持久化和插件停用清理。

<!-- section: mobile -->
## 移动端

移动端开放前必须保留物理设备、系统版本、Obsidian 版本、触摸选择和中英文输入法组合输入证据。
