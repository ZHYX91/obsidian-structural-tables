---
doc_id: testing-strategy
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-24
translation_of: testing-strategy.zh-CN.md
---

[简体中文](testing-strategy.zh-CN.md)

# Testing strategy

<!-- section: levels -->
## Levels

Pure-core unit tests, DOM rendering tests, plugin wiring tests, packaged-candidate checks, and real Obsidian acceptance are separate levels whose conclusions cannot substitute for one another.

<!-- section: parser-cases -->
## Parser cases

Cover ordinary GFM non-ownership, the three-hyphen delimiter minimum, horizontal and vertical merges, multi-row headers, row headers, escaped markers and pipes, code spans, code blocks, BOM-prefixed frontmatter with both valid closing markers, and LF/CRLF/CR preservation.

<!-- section: invalid-cases -->
## Negative cases

Cover missing anchors, nonrectangles, role crossing, edge/multiple/spaced `||`, and inconsistent width. Assert that source is unchanged and diagnostics are stable.

<!-- section: commands -->
## Commands

Cover safe merges, non-empty refusal, splitting, insert/delete/move/alignment transformations, merged-anchor migration, Wiki-link pipe escaping without double escapes, and canonical formatting. Every candidate edit is parsed again. DOM tests cover handles, menus, in-place editing, one-transaction Tab commit, and IME composition. Settings tests overlap writes and verify immutable snapshots and deterministic final state.

<!-- section: host -->
## Host acceptance

In an explicitly named disposable Vault, test minimum and current Obsidian, light and dark themes, Live Preview note opening and cursor transitions, cell edit/paste/Tab/IME behavior, row/column handles and every menu operation, ordinary-table native behavior, Reading view native-table and raw row-header rendering, settings persistence, undo/redo, and disable cleanup. Repository documentation screenshots use an English disposable Vault, exclude the mouse pointer, and do not count as production deployment evidence.

<!-- section: mobile -->
## Mobile

Before enabling mobile availability, retain physical device, OS, Obsidian version, touch-selection, and Chinese/English IME composition evidence.
