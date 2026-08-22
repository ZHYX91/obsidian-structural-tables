---
doc_id: testing-strategy
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-22
translation_of: testing-strategy.zh-CN.md
---

[简体中文](testing-strategy.zh-CN.md)

# Testing strategy

<!-- section: levels -->
## Levels

Pure-core unit tests, DOM rendering tests, plugin wiring tests, packaged-candidate checks, and real Obsidian acceptance are separate levels whose conclusions cannot substitute for one another.

<!-- section: parser-cases -->
## Parser cases

Cover ordinary GFM non-ownership, horizontal and vertical merges, multi-row headers, row headers, escaped markers and pipes, code spans, code blocks, and frontmatter.

<!-- section: invalid-cases -->
## Negative cases

Cover missing anchors, nonrectangles, role crossing, edge/multiple/spaced `||`, and inconsistent width. Assert that source is unchanged and diagnostics are stable.

<!-- section: commands -->
## Commands

Cover safe merges, non-empty refusal, splitting, and canonical formatting. Every candidate edit is parsed again.

<!-- section: host -->
## Host acceptance

In an explicitly named disposable Vault, test minimum and current Obsidian, light and dark themes, Live Preview cursor transitions, Reading view, settings persistence, and disable cleanup.

<!-- section: mobile -->
## Mobile

Before enabling mobile availability, retain physical device, OS, Obsidian version, touch-selection, and Chinese/English IME composition evidence.
