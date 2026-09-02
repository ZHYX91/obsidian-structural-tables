---
doc_id: testing-strategy
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-28
translation_of: testing-strategy.zh-CN.md
---

[简体中文](testing-strategy.zh-CN.md)

# Structural Tables — Testing strategy

<!-- section: levels -->
## Levels

Pure-core unit tests, DOM rendering tests, plugin wiring tests, packaged-candidate checks, and real Obsidian acceptance are separate levels whose conclusions cannot substitute for one another.

<!-- section: parser-cases -->
## Parser cases

Cover ordinary GFM non-ownership by default and inclusion under explicit takeover, the three-hyphen delimiter minimum, horizontal and vertical merges, multi-row headers, row headers, escaped markers and pipes, code spans, code blocks, BOM-prefixed frontmatter with both valid closing markers, and LF/CRLF/CR preservation.

<!-- section: invalid-cases -->
## Negative cases

Cover missing anchors, nonrectangles, role crossing, edge/multiple/spaced `||`, and inconsistent width. Assert that source is unchanged and diagnostics are stable.

<!-- section: commands -->
## Commands

Cover safe merges, non-empty refusal, splitting, insert/delete/move/alignment transformations, merged-anchor migration, Wiki-link pipe escaping without double escapes, and canonical formatting. Every candidate edit is parsed again. DOM tests cover ordinary takeover and release, full owned menus, semantic header roles, handles, in-place editing, one-transaction Tab commit, and IME composition. Settings tests cover the default-off takeover flag; pure, idempotent normalization; unversioned-to-schema-1 migration; current-schema loading; future and malformed explicit-schema refusal without writes; immutable serialized snapshots; visible failure and retry states; and unload flushing.

<!-- section: interchange -->
## Interchange cases

Core tests cover multi-row header paths, repeated merged values, semantic HTML spans/scope, CSV quoting, TSV cleanup, and both positive and negative Sheets Extended separator cases. DOM tests cover HTML clipboard data with thead/th/td/rowspan/colspan, a td-only first-row fallback, and non-table or one-column pass-through. GFM replacement must reparse at confirmation time and refuse a stale snapshot.

<!-- section: base-promotion -->
## Base promotion cases

Pure-core tests cover duplicate, non-Latin, and reserved property keys; filename safety; current and legacy list membership, equivalent dual values, and invalid/conflicting values; deterministic flattening warnings for multi-row/merged column headers and row headers; merged-data blocker coordinates and spans; and plugin Base metadata location. Menu tests distinguish ordinary "Upgrade to Base" from structural "Expand structure and upgrade to Base" actions. In-memory Vault transaction tests verify that a blocked plan writes nothing, and cover records and manifest preceding source replacement, no per-record identity writes, whole-directory cleanup when the table changes during creation, restoration that keeps records, current-folder creation after a host move, missing or mismatched manifests, and target collisions. Migration tests cover preview counts, optional retired-ID cleanup, stale/conflict refusal, Base-filter replacement, and rollback after a later write fails.

<!-- section: host -->
## Host acceptance

In an explicitly named disposable Vault, test minimum and current Obsidian, light and dark themes, the default content-width layout, theme-aware column/corner versus row-header backgrounds, native-looking structural borders, per-handle hiding/reveal on idle/hover/focus/selection without whole-table handle exposure, Live Preview note opening and cursor transitions, cell edit/paste/Tab/IME behavior, HTML-table paste and disabled pass-through, HTML/GFM/TSV/CSV clipboard results, GFM preview confirm/cancel/stale refusal, Sheets Extended migration, conflict warning, Bases-disabled refusal, both right-click Base-upgrade labels, flattening preview, merged-data disabled confirmation with no writes, upgrade confirmation/failure cleanup, generated records and membership, continued results after record move/rename, post-host-move record location, restoration that keeps records, missing-manifest refusal, row/column handles and every menu operation, ordinary-table native behavior while takeover is disabled, ordinary-table ownership in Live Preview and Reading view while enabled, immediate source-preserving release after disabling, settings persistence, undo/redo, and disable cleanup. Repository documentation screenshots use an English disposable Vault, exclude the mouse pointer, and do not count as production deployment evidence.

<!-- section: mobile -->
## Mobile

Every mobile release candidate requires current Android-emulator evidence for startup, Reading view, Live Preview, two-tap rectangular selection, long-press menus, touch-sized handles, in-place editing, and Chinese/English IME composition. Record the AVD, OS, Obsidian version, candidate identity, and scenario result. Android physical devices and iOS are out of scope.
