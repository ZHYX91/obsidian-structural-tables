---
doc_id: ux-spec
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-23
translation_of: ux-spec.zh-CN.md
---

[简体中文](ux-spec.zh-CN.md)

# UX specification

<!-- section: principles -->
## Principles

Source remains visible and recoverable; rendering interprets but never rewrites; an operation that could lose content is refused.

<!-- section: live-preview -->
## Live Preview

Show the semantic table while every cursor and selection is outside it. Reveal raw Markdown immediately on entry. Do not switch rendering during IME composition.

<!-- section: reading-view -->
## Reading view

Render with `thead`, `tbody`, `th`, `td`, `rowspan`, `colspan`, and suitable `scope` values. Continue to use Obsidian Markdown rendering inside cells.

<!-- section: commands -->
## Commands

Insert template, format, merge left, merge up, split, and validate are available in the command palette. A merge from a non-empty cell explains the refusal and preserves source.

<!-- section: table-selection -->
## Table selection and context menu

Use Obsidian's native Markdown-table cell selection, whole-row/whole-column handles, and editor context menu without showing a second set of handles at the same time. A rectangular multi-cell selection offers Merge selected cells; a single merged cell offers Split merged cell. Refuse a merge and preserve source when cells other than the top-left contain content, the selection crosses role boundaries, or it includes only part of an existing merged region.

A whole-row selection starting at the top of the table can set column-header rows. A whole-column selection starting at the left and covering every table row can set or remove row-header columns. Refuse a boundary change that would make a merge cross role regions. Dragging Obsidian's native handles continues to reorder rows and columns.

<!-- section: diagnostics -->
## Diagnostics

Invalid structures get a red edge and a readable reason. Reading view keeps its original table, and the editor never conceals invalid source.

<!-- section: settings -->
## Settings

Use native Obsidian controls and top tabs for General, Views, and Appearance. Language is in the first General tab; automatic language is labeled Follow Obsidian and includes a description. Appearance offers table layouts for content-aligned left, content-aligned center, and current-pane width. Table layout changes the table box, never cell-content alignment. Labels and descriptions support English and Simplified Chinese.
