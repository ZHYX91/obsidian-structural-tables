---
doc_id: product-requirements
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-28
translation_of: product-requirements.zh-CN.md
---

[简体中文](product-requirements.zh-CN.md)

# Structural Tables — Product requirements

<!-- section: purpose -->
## Purpose

Let users express merged cells, multi-row column headers, and row headers with readable pipe-table Markdown, with dependable Obsidian rendering and safe editing.

<!-- section: syntax -->
## Syntax contract

An exact `<` merges left, `^` merges up, and `\<` or `\^` is literal text. Every delimiter cell follows GFM and contains at least three hyphens. Contiguous equal-width rows before the delimiter are column headers. At most one whitespace-free `||` inside the delimiter marks columns to its left as row headers and does not add a column.

<!-- section: validity -->
## Validity

Every structural row has exactly the delimiter width. A merge resolves to one top-left content anchor, forms a complete rectangle, stays in bounds, and cannot cross corner-header, column-header, row-header, or data regions. Invalid source is retained without guessing or automatic repair.

<!-- section: capabilities -->
## Capabilities

Reading view and Live Preview rendering on desktop and Android; default-native ordinary GFM tables with an opt-in, reversible takeover mode that changes no Markdown; in-place cell editing with table-safe Wiki-link pipe escaping and IME protection; mouse drag selection plus two-tap rectangular selection on touch screens; touch-sized coarse-pointer row/column handles that remain visible without hover; theme-aware column/corner and lighter row-header backgrounds; native-looking table borders; insert, safe delete, move, align, format, merge left/up, rectangular-selection merge, split, header setting, and note validation; integration with Obsidian's native ordinary-table selection and context menu; HTML-table paste with rowspan/colspan preservation; semantic HTML, plain GFM, TSV, and CSV output; Sheets Extended separator migration and conflict warnings; right-click Base upgrade for ordinary and structural tables; an explicit preview that flattens multi-row/merged column headers into property paths, turns row headers into properties, and blocks merged data cells before any file is written; path-independent list membership, stable record IDs, a recovery manifest, table restoration that keeps records, and later-record creation beside the host's current folder; native bilingual settings; and explicit diagnostics. Formatting and structural edits are explicit actions. Rendering never changes source.

<!-- section: exclusions -->
## Exclusions

The plugin excludes formulas, styling, block or multiline content, captions and numbering, repeated-header source attributes, and automatic rich-text-to-Markdown conversion inside imported HTML cells. Base promotion does not guess record semantics for merged data cells, replace the native Bases New button, or delete generated or later-moved record notes during restoration.

<!-- section: success -->
## Acceptance

Pure-core tests cover positive, negative, and canonical serialization cases; packages are reproducible and offline; real Obsidian acceptance stays distinct from automation. Every mobile candidate requires current Android-emulator evidence, while physical-device evidence remains a separate release gate for touch, IME, storage, or platform-boundary changes.
