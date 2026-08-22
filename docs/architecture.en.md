---
doc_id: architecture
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-22
translation_of: architecture.zh-CN.md
---

[简体中文](architecture.zh-CN.md)

# Architecture

<!-- section: boundaries -->
## Boundaries

`src/core` is host-independent pure TypeScript. Configuration, rendering, editor, Reading view, and app wiring are layered. The public repository depends on no adjacent repository or local Vault.

<!-- section: parser -->
## Parser

The parser scans delimiter candidates, skips frontmatter, fenced code, and indented code, respects escaped pipes and code spans, and emits source ranges, role grids, merge anchors, and diagnostics.

<!-- section: validation -->
## Validation

Merges resolve only left or up, preventing directional cycles. Validation then checks anchors, role boundaries, and rectangular closure. Strict row width applies after structural mode is active.

<!-- section: rendering -->
## Rendering

One shared DOM renderer serves the Reading view postprocessor and CodeMirror widget. Cell content uses Obsidian MarkdownRenderer, with component lifecycle cleanup.

<!-- section: editing -->
## Editing

Commands produce candidate source from an in-memory grid and parse it again. They replace the current table range only when the result is valid and no content is lost.

<!-- section: release -->
## Release

Node, npm, and dependency versions are locked. CI runs the canonical gate. The tag workflow transfers exact build assets, verifies digests, and publishes an immutable Release.
