---
doc_id: ux-spec
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-09-02
translation_of: ux-spec.zh-CN.md
---

[简体中文](ux-spec.zh-CN.md)

# Structural Tables — UX specification

<!-- section: principles -->
## Principles

Source remains visible and recoverable; rendering interprets but never rewrites; an operation that could lose content is refused.

<!-- section: live-preview -->
## Live Preview

Show the semantic table while every CodeMirror cursor and selection is outside it. In the rendered widget, a desktop click, touch-screen double-tap, or Enter/F2 opens a one-line in-place cell editor; desktop drag and modified gestures continue to select cells, and links remain actionable. Enter commits, Escape cancels, and Tab commits and advances. Pasted unescaped table pipes are escaped immediately outside code spans without doubling existing escapes. Do not commit or switch rendering during IME composition.

<!-- section: reading-view -->
## Reading view

Render with `thead`, `tbody`, `th`, `td`, `rowspan`, `colspan`, and suitable `scope` values. Continue to use Obsidian Markdown rendering inside cells.

<!-- section: commands -->
## Commands

Insert template, format, merge left, merge up, split, validate, copy HTML/GFM/TSV/CSV, preview and flatten to plain GFM, migrate a Sheets Extended separator, and migrate legacy Structural Tables Base properties are available in the command palette. Formatting and flattening to GFM first show a scrollable, selectable result preview and reparse the unchanged source table when the user confirms; neither changes source before confirmation. A merge from a non-empty cell explains the refusal and preserves source.

<!-- section: interchange -->
## Paste and interchange

When Preserve pasted HTML table spans is enabled, paste is intercepted only when the clipboard contains a verifiable multi-column table; otherwise Obsidian keeps its native behavior. A thead or consecutive th rows become column headers, consecutive leftmost th columns in the body become row headers, and rowspan/colspan become canonical `^`/`<` markers. Cell content is imported as plain text, with HTML break and block boundaries normalized to canonical `<br>` visual breaks. Plain GFM, TSV, and CSV output repeats merged values and joins multi-row header paths with ` / `; HTML output preserves semantic roles, spans, scope, and break elements.

<!-- section: base-promotion -->
## Upgrade to Base

Right-click an ordinary table to choose Upgrade to Base; an owned structural table labels the same action Expand structure and upgrade to Base. The action works only on a valid table in a saved note and requires the Bases core plugin. Its preview shows the target folder, record count, display-column to stable-property mapping, generated Base source, and every applicable flattening rule: multi-row header paths join with ` / `, merged column headers expand into covered property paths, row headers become ordinary properties, and merged row-header values repeat per record. New promotions preserve trimmed non-empty header paths, including numeric and leading-zero names, as Property keys; all generated Base references use bracket notation. Only a wholly blank header receives `column_n`; canonical duplicate or reserved keys receive a numeric suffix. Existing promoted Bases and records are read without migration. A merged data-region cell remains visible as a row/column/span blocker and disables confirmation. The execute layer checks blockers again before any file creation. While valid work runs the button stays disabled; a failure explains the cause, keeps the table, and sends this promotion's directory to trash.

Metadata comments in the generated Base retain the stable table ID and recovery-manifest path. With the cursor on that Base, plugin commands can create a blank record using the host's current folder or preview and restore the original table. Restoration explicitly says generated records are kept. Moving, renaming, or organizing a record produces no warning and does not change membership.

The legacy-property migration scans the Vault only after an explicit command. Its modal lists every affected file with its intended change and the counts of membership notes, promoted Base blocks, and retired record IDs. Record-ID cleanup is an off-by-default toggle; changing it immediately updates the selected-removal count and each affected file's action. Cleanup applies only to notes with valid, non-empty Structural Tables membership. Confirmation stale-checks every file and the exact plugin-owned frontmatter values, rejects a source change immediately before a Base rewrite, replaces `structural_table_ids` with `structural-tables`, updates legacy Base filters across LF, CRLF, and CR line endings, and preserves unrelated Properties and note bodies. If a later file fails, rollback reverses only the migration-owned Properties and exact Base blocks so unrelated concurrent edits survive. Base-block discovery ignores examples nested inside longer Markdown fences. Invalid or conflicting old/new membership values stop before the preview can be confirmed.

<!-- section: table-selection -->
## Table selection and context menu

By default, use Obsidian's native Markdown-table cell selection, whole-row/whole-column handles, and shared event menu to bootstrap structural syntax from an ordinary GFM table. When Take over ordinary Markdown tables is enabled, inactive ordinary GFM tables use the same plugin widget, handles, in-place editor, full editing menu, layout, density, and alternating-row appearance as structural tables without changing their source; disabling the setting refreshes open views back to native behavior. A mouse drags across cells. On touch screens, tap the first and last cells to select a rectangle; the initial pointer event remains available to the host so horizontal scrolling and long-press menus are not suppressed. Both ordinary and owned structural table menus expose the appropriate Base-upgrade action without requiring whole-table selection. On fine pointers, hovering a cell reveals only its corresponding row and column handles; a keyboard-focused or selected handle stays visible. Coarse-pointer handles remain visible and at least 44 CSS pixels. Handles are absolutely overlaid in the outer gutter and positioned from the real table rectangle, so content-left, content-center, and pane layouts retain their table alignment. Cell focus must not reveal every desktop handle, and an owned selection clears when focus or the CodeMirror selection leaves that table or another owned table receives the pointer. Cells, row handles, and column handles each expose one tab stop; arrow keys and Home/End move focus within the active group, with horizontal movement following RTL direction. Focus remains visibly outlined. Comfortable and compact cells keep stable minimum dimensions before and after a merge; coarse pointers preserve their touch minimum. While a cell editor is open, Shift+Enter and **Insert line break in cell** from its context menu insert canonical `<br>`, and multiline plain-text paste normalizes each line boundary the same way. The existing native-like column selection treatment is preserved. A rectangular multi-cell selection offers Merge selected cells; a single merged cell offers Split merged cell. Refuse a merge and preserve source when cells other than the top-left contain content, the selection crosses role boundaries, or it includes only part of an existing merged region.

A whole-row selection starting at the top can set column-header rows. A whole-column selection starting at the left and covering every row can set or remove row-header columns. Plugin-owned table menus also insert, safely delete, move, and align selected rows or columns. Insertion inside a merge expands it; deletion migrates a surviving anchor; any edit that would discard non-empty content, split a merged rectangle, or cross a header boundary is refused. Ordinary tables retain Obsidian's native menus and handles while takeover is disabled.

<!-- section: diagnostics -->
## Diagnostics

Invalid structures get a red edge and a readable reason. Reading view keeps its original table, and the editor never conceals invalid source.

<!-- section: settings -->
## Settings

Use native Obsidian controls and top tabs for General, Views, and Appearance. The active tab combines an accent underline with a semibold label, and stable space separates the baseline from the content panel. A failed settings save stays visible with an explicit Retry action. Settings from an incompatible explicit schema show a persistent warning and disable controls while preserving the three-tab navigation. Language, HTML-table paste conversion, and startup conflict warnings are General controls; automatic language is labeled Follow Obsidian and includes a description. Views contains a default-off Take over ordinary Markdown tables toggle whose description states that source stays standard, disabling restores native tables, and other table plugins may conflict. Appearance defaults new installations to content-aligned left and also offers content-centered and current-pane width. Rendered column and corner headers use a stronger theme-derived background; row headers use a lighter theme-derived background; alternating rows affect only data cells. Table layout changes the table box, never cell-content alignment. Labels and descriptions support English and Simplified Chinese.
