---
doc_id: product-requirements
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-22
translation_of: product-requirements.zh-CN.md
---

[简体中文](product-requirements.zh-CN.md)

# Product requirements

<!-- section: purpose -->
## Purpose

Let users express merged cells, multi-row column headers, and row headers with readable pipe-table Markdown, with dependable Obsidian rendering and safe editing.

<!-- section: syntax -->
## Syntax contract

An exact `<` merges left, `^` merges up, and `\<` or `\^` is literal text. Contiguous equal-width rows before the delimiter are column headers. At most one whitespace-free `||` inside the delimiter marks columns to its left as row headers and does not add a column.

<!-- section: validity -->
## Validity

Every structural row has exactly the delimiter width. A merge resolves to one top-left content anchor, forms a complete rectangle, stays in bounds, and cannot cross corner-header, column-header, row-header, or data regions. Invalid source is retained without guessing or automatic repair.

<!-- section: capabilities -->
## Initial capabilities

Reading view and Live Preview rendering; insert, format, merge left/up, split, and note validation commands; native bilingual settings; and explicit diagnostics. Formatting is an explicit command. Rendering never changes source.

<!-- section: exclusions -->
## Exclusions

The first release excludes formulas, styling, block or multiline content, captions and numbering, repeated-header source attributes, HTML export, and plain-GFM expansion.

<!-- section: success -->
## Acceptance

Pure-core tests cover positive, negative, and canonical serialization cases; packages are reproducible and offline; real Obsidian acceptance stays distinct from automation; mobile availability is not claimed before device evidence.
