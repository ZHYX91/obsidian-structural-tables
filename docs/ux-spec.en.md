---
doc_id: ux-spec
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-26
translation_of: ux-spec.zh-CN.md
---

[简体中文](ux-spec.zh-CN.md)

# Structural Tables — UX specification

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

Insert template, format, merge left, merge up, split, validate, copy HTML/GFM/TSV/CSV, preview and flatten to plain GFM, and migrate a Sheets Extended separator are available in the command palette. A merge from a non-empty cell explains the refusal and preserves source. Flattening to GFM first shows a scrollable, selectable result preview and reparses the unchanged source table when the user confirms.

<!-- section: interchange -->
## Paste and interchange

When Preserve pasted HTML table spans is enabled, paste is intercepted only when the clipboard contains a verifiable multi-column table; otherwise Obsidian keeps its native behavior. A thead or consecutive th rows become column headers, consecutive leftmost th columns in the body become row headers, and rowspan/colspan become canonical `^`/`<` markers. Cell content is imported as plain text. Plain GFM, TSV, and CSV output repeats merged values and joins multi-row header paths with ` / `; HTML output preserves semantic roles, spans, and scope.

<!-- section: base-promotion -->
## Upgrade to Base

Right-click an ordinary table to choose Upgrade to Base; an owned structural table labels the same action Expand structure and upgrade to Base. The action works only on a valid table in a saved note and requires the Bases core plugin. Its preview shows the target folder, record count, display-column to stable-property mapping, generated Base source, and every applicable flattening rule: multi-row header paths join with ` / `, merged column headers expand into covered property paths, row headers become ordinary properties, and merged row-header values repeat per record. A merged data-region cell remains visible as a row/column/span blocker and disables confirmation. The execute layer checks blockers again before any file creation. While valid work runs the button stays disabled; a failure explains the cause, keeps the table, and sends this promotion's directory to trash.

Metadata comments in the generated Base retain the stable table ID and recovery-manifest path. With the cursor on that Base, plugin commands can create a blank record using the host's current folder or preview and restore the original table. Restoration explicitly says generated records are kept. Moving, renaming, or organizing a record produces no warning and does not change membership.

<!-- section: table-selection -->
## Table selection and context menu

By default, use Obsidian's native Markdown-table cell selection, whole-row/whole-column handles, and shared event menu to bootstrap structural syntax from an ordinary GFM table. When Take over ordinary Markdown tables is enabled, inactive ordinary GFM tables use the same plugin widget, handles, drag selection, in-place editor, full editing menu, layout, density, and alternating-row appearance as structural tables without changing their source; disabling the setting refreshes open views back to native behavior. Both ordinary and owned structural table menus expose the appropriate Base-upgrade action without requiring whole-table selection. Each plugin handle remains hidden until that specific row or column control is hovered, keyboard-focused, or selected; cell focus must not reveal every handle. The existing native-like column selection treatment is preserved. A rectangular multi-cell selection offers Merge selected cells; a single merged cell offers Split merged cell. Refuse a merge and preserve source when cells other than the top-left contain content, the selection crosses role boundaries, or it includes only part of an existing merged region.

A whole-row selection starting at the top can set column-header rows. A whole-column selection starting at the left and covering every row can set or remove row-header columns. Plugin-owned table menus also insert, safely delete, move, and align selected rows or columns. Insertion inside a merge expands it; deletion migrates a surviving anchor; any edit that would discard non-empty content, split a merged rectangle, or cross a header boundary is refused. Ordinary tables retain Obsidian's native menus and handles while takeover is disabled.

<!-- section: diagnostics -->
## Diagnostics

Invalid structures get a red edge and a readable reason. Reading view keeps its original table, and the editor never conceals invalid source.

<!-- section: settings -->
## Settings

Use native Obsidian controls and top tabs for General, Views, and Appearance. The active tab combines an accent underline with a semibold label, and stable space separates the baseline from the content panel. Language, HTML-table paste conversion, and startup conflict warnings are General controls; automatic language is labeled Follow Obsidian and includes a description. Views contains a default-off Take over ordinary Markdown tables toggle whose description states that source stays standard, disabling restores native tables, and other table plugins may conflict. Appearance defaults new installations to content-aligned left and also offers content-centered and current-pane width. Rendered column and corner headers use a stronger theme-derived background; row headers use a lighter theme-derived background; alternating rows affect only data cells. Table layout changes the table box, never cell-content alignment. Labels and descriptions support English and Simplified Chinese.
