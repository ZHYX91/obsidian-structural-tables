---
doc_id: architecture
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-24
translation_of: architecture.zh-CN.md
---

[简体中文](architecture.zh-CN.md)

# Architecture

<!-- section: boundaries -->
## Boundaries

`src/core` is host-independent pure TypeScript. Configuration, rendering, editor, Reading view, and app wiring are layered. The public repository depends on no adjacent repository or local Vault.

<!-- section: parser -->
## Parser

The parser scans GFM delimiter candidates with at least three hyphens, skips BOM-prefixed frontmatter closed by either `---` or `...`, fenced code, and indented code, respects escaped pipes and code spans, and emits source ranges, role grids, merge anchors, and diagnostics.

<!-- section: validation -->
## Validation

Merges resolve only left or up, preventing directional cycles. Validation then checks anchors, role boundaries, and rectangular closure. Strict row width applies after structural mode is active.

<!-- section: rendering -->
## Rendering

One shared DOM renderer serves the Reading view postprocessor and CodeMirror widget. Live Preview stores block decorations in a CodeMirror `StateField`, while a separate view plugin owns composition and view lifecycle. The structural widget adds cell selection, row/column handles, and a focused textarea editor without moving the CodeMirror cursor into the replaced range. Reading view can map either an Obsidian-native table or the exact raw source block emitted for row-header syntax; recursive renderer callbacks are ignored. Cell content uses Obsidian MarkdownRenderer, with component lifecycle cleanup.

<!-- section: editing -->
## Editing

Commands and in-place edits produce candidate source from a pure in-memory ownership grid and parse it again. Row/column transformations rebuild rectangular merge ownership, migrate surviving anchors, and refuse content loss or invalid boundaries. Cell input escapes unescaped pipes outside code spans before one whole-table CodeMirror transaction. Serialization preserves the note's existing LF, CRLF, or CR line ending.

<!-- section: settings -->
## Settings

Settings saves pass through one serialized coordinator. Each queued save owns an immutable snapshot, so overlapping changes cannot persist a later mutable object under an earlier request.

<!-- section: release -->
## Release

Node, npm, and dependency versions are locked. CI runs the canonical gate. The tag workflow transfers exact build assets, verifies digests, and publishes an immutable Release.
