---
doc_id: ux-spec
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-24
translation_of: ux-spec.zh-CN.md
---

[简体中文](ux-spec.zh-CN.md)

# UX specification

<!-- section: principles -->
## Principles

Source remains visible and recoverable; rendering interprets but never rewrites; an operation that could lose content is refused.

<!-- section: live-preview -->
## Live Preview

Show the semantic table while every CodeMirror cursor and selection is outside it. In the rendered widget, double-click or Enter/F2 opens a one-line in-place cell editor; Enter commits, Escape cancels, and Tab commits and advances. Pasted unescaped table pipes are escaped immediately outside code spans without doubling existing escapes. Do not commit or switch rendering during IME composition.

<!-- section: reading-view -->
## Reading view

Render with `thead`, `tbody`, `th`, `td`, `rowspan`, `colspan`, and suitable `scope` values. Continue to use Obsidian Markdown rendering inside cells.

<!-- section: commands -->
## Commands

Insert template, format, merge left, merge up, split, and validate are available in the command palette. A merge from a non-empty cell explains the refusal and preserves source.

<!-- section: table-selection -->
## Table selection and context menu

Use Obsidian's native Markdown-table cell selection, whole-row/whole-column handles, and shared event menu to bootstrap structural syntax from an ordinary GFM table. Because Obsidian's native widget cannot represent merged or multi-row/row-header structure, an already-rendered structural table supplies its own cell drag selection, whole-row/whole-column handles, keyboard-accessible in-place editor, and context-menu contribution. A rectangular multi-cell selection offers Merge selected cells; a single merged cell offers Split merged cell. Refuse a merge and preserve source when cells other than the top-left contain content, the selection crosses role boundaries, or it includes only part of an existing merged region.

A whole-row selection starting at the top can set column-header rows. A whole-column selection starting at the left and covering every row can set or remove row-header columns. Structural-table menus also insert, safely delete, move, and align selected rows or columns. Insertion inside a merge expands it; deletion migrates a surviving anchor; any edit that would discard non-empty content, split a merged rectangle, or cross a header boundary is refused. Ordinary tables retain Obsidian's native menus and handle behavior.

<!-- section: diagnostics -->
## Diagnostics

Invalid structures get a red edge and a readable reason. Reading view keeps its original table, and the editor never conceals invalid source.

<!-- section: settings -->
## Settings

Use native Obsidian controls and top tabs for General, Views, and Appearance. The active tab combines an accent underline with a semibold label, and stable space separates the baseline from the content panel. Language is in the first General tab; automatic language is labeled Follow Obsidian and includes a description. Appearance defaults new installations to current-pane width and also offers content-aligned left and center. Table layout changes the table box, never cell-content alignment. Labels and descriptions support English and Simplified Chinese.
