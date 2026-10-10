---
doc_id: ux-spec
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-10-10
translation_of: ux-spec.zh-CN.md
---

[简体中文](ux-spec.zh-CN.md)

# Structural Tables — UX specification

<!-- section: principles -->
## Principles

Source remains visible and recoverable; rendering interprets but never rewrites; unintended loss of unselected or hidden content is refused. Explicit clear/remove actions may discard the selected visible content, while guarded legacy operations keep their loss-prevention contract.

<!-- section: live-preview -->
## Live Preview

A valid structural table is presented by a semantic block widget while its Markdown remains authoritative in the CodeMirror document. When the native CodeMirror source surface owns focus and its selection intersects the table, raw Markdown is shown for direct editing; opening an external control preserves that source-editing session and its exact selection. Visual cell interactions synchronize the logical source position without leaving presentation mode. **Edit table source** explicitly hands focus and the mapped cell position back to CodeMirror.

### Cell editing

- Desktop click, touch double-tap, or Enter/F2 opens the editor. A provably plain-text desktop click places the textarea caret at the clicked UTF-16 offset; formatted or ambiguous content, keyboard entry, and touch entry select the draft instead of guessing a Markdown offset.
- The editor overlays the existing cell without changing column width or adding a second visible input border. Its editing surface does not inherit the grid-range selection fill, so theme header/zebra/background and borders remain visible around the caret.
- Enter commits and opens the same logical column on the next row; at the last row the edit and appended row are one host transaction. Escape cancels, and Shift+Enter inserts a draft line break.
- Tab/Shift+Tab follows visible cells in source order and skips covered merge slots. At a collapsed horizontal text boundary, Left/Right may move to the adjacent visible cell; internal text arrows and text selections remain native. Up/Down moves between rows only when textarea geometry proves a stable single visual line; otherwise it stays native.
- While the textarea owns editing focus, Cmd/Ctrl+B and Cmd/Ctrl+I toggle bold/italic only on its current draft selection and preserve the other emphasis style. Typing, composition input, paste, draft line breaks, and these format operations participate in one draft-local undo/redo history; inherited main-editor history and formatting commands must not touch saved source before commit. Other formatting commands remain source-oriented and require **Edit table source**.
- A rejected commit keeps the complete draft, does not navigate, and does not append a row.
- Outside the textarea, unmodified Delete/Backspace clears the complete visible owner set represented by the current grid selection. Clearing never removes rows, columns, header roles, alignments, merge topology, or the table itself; an already-empty selection is a no-op.
- The owned grid context menu offers the same clear intent plus explicit Delete selected rows, Delete selected columns, and Delete table actions. Explicit removal may discard the selected visible content without a pre-clear step, remains one undoable host transaction, and removes the whole table when all rows or all columns are explicitly selected.
- Shift+Arrow extends or shrinks a grid range from its original logical anchor/head and reuses merge-owner closure; it never replaces the logical head with expanded bounds. Textarea selection shortcuts remain text-local.
- Ordinary GFM retains Obsidian's native Delete behavior while takeover is disabled. When takeover is enabled, the same clear/removal policy applies; hidden GFM overflow remains read-only until its extra source cells are handled in Markdown.
- IME composition must not be committed early or have its keys intercepted.

### Lifecycle and focus

Source-position changes, edits elsewhere in the note, or table-index shifts should keep an active edit bound to the same unchanged table. If an external change invalidates the target, stop the write and retain a recoverable draft.

After undo/redo, restore focus to the corresponding visible cell when possible. Callout tables follow the same rule and must not expose the whole source block merely because the host rerenders it.

### Ordinary GFM tables

Obsidian's native table UI remains the default. With **Take over ordinary Markdown tables** enabled, ordinary GFM uses the same rendering and editing controls as structural tables while its source stays standard GFM. Turning the setting off restores the native UI immediately.

<!-- section: reading-view -->
## Reading view

Render with `thead`, `tbody`, `th`, `td`, `rowspan`, `colspan`, and suitable `scope` values. Continue to use Obsidian Markdown rendering inside cells.

<!-- section: commands -->
## Commands

Insert template, format, merge left, merge up, split, validate, copy HTML/GFM/TSV/CSV, preview and flatten to plain GFM, migrate a Sheets Extended separator, and migrate legacy Structural Tables Base properties are available in the command palette. Formatting and flattening to GFM first show a scrollable, selectable result preview and reparse the unchanged source table when the user confirms; neither changes source before confirmation. A merge from a non-empty cell explains the refusal and preserves source.

<!-- section: interchange -->
## Paste and interchange

In the note editor's HTML-import route, a verifiable multi-column table is converted structurally when Preserve pasted HTML table spans is enabled.

A single otherwise-safe table that is either completely empty or contains only text semantics the importer cannot preserve faithfully (`pre`, `sup`, or `sub`) uses the complete non-empty plain-text clipboard alternative verbatim when available; no TSV, Markdown, or TeX equivalence is inferred. If that known-lossy payload has no plain-text alternative, the paste is blocked and the current selection is kept.

Mixed-content, multi-table, image, HTML `embed`, attachment, link, MathML/SVG, rich semantics on or around the table, clipboard files, and non-text clipboard MIME payloads remain native paste rather than being downgraded to plain text.

Ordinary `div`/`span` wrappers and additional `text/*` MIME representations do not by themselves disable the narrow plain-text fallback.

A thead or consecutive th rows become column headers, consecutive leftmost th columns in the body become row headers, and rowspan/colspan become canonical `^`/`<` markers.

Cell content is imported as plain text, with HTML break and block boundaries normalized to canonical `<br>` visual breaks.

A selected owned-grid range has a separate bounded clipboard contract. Copy emits the plugin's normalized owner topology and raw tokens without writing source. Cut clears only after clipboard write success and exact source/path/range/selection/session revalidation. Paste accepts only this plugin's range payload, requires exact dimensions and owner topology, and replaces only selected owner raw tokens in one validated table write. Single cells, single columns, all-empty ranges, and complete horizontal/vertical/2D merges are supported. Plain text, ordinary HTML, unsupported range data, and stale sessions produce no source write and never fall through to the hidden CodeMirror caret.

Menu Copy/Cut and menu Paste check platform clipboard-write and clipboard-read support independently; support for one does not imply support for the other. To paste ordinary text, enter a single cell's editor. To import an HTML table, use the note editor; **Edit table source** provides direct Markdown editing.

Mobile range menus use verified text-only clipboard transport because the host's rich clipboard bridge may only support images. Copy/Cut writes portable GFM and reads it back before reporting success or clearing content. A session-only owner payload is scoped to that clipboard; Paste uses it only after an exact system-text match and unchanged copy identity across the asynchronous read. Changed or unowned text, failed readback and superseded copies never infer topology or write source. The existing frozen source/selection/session and exact target-topology checks still apply. Restarting the host or plugin loses the session payload; desktop rich transports and textarea clipboard behavior remain unchanged.

Whole-table HTML copy commands also bypass the mobile image-only rich bridge and use their complete tab-separated text alternative. This existing TSV projection converts cell-internal line breaks and tabs to spaces while retaining row separators and column tabs. Desktop HTML and plain-text representations remain unchanged; mobile whole-table text does not carry rich formatting or merge topology.

Range Copy also exposes portable HTML and plain Markdown. Range HTML escapes each owner's raw Markdown as text and represents spans; it does not render that Markdown as rich content. Plain Markdown makes the first copied row a header and retains structural markers where representable. It does not promise equivalent merge topology in external GFM, especially for vertical merges.

Plain GFM, TSV, and CSV whole-table output repeats merged values and joins multi-row header paths with ` / `; HTML output preserves semantic roles, spans, scope, and break elements.

HTML conversion accepts one complete supported table only. Mixed prose, multiple tables, captions, math, images, attachments, and links that cannot be preserved are left to native note paste. In a cell editor, unsupported HTML uses the complete plain-text alternative with a notice; if none exists, the current edit remains intact. A verified empty cell can still clear the selected text. HTML copy falls back to original Markdown/LaTeX for math, images, attachments, and internal or relative links, preserving references without embedding arbitrary HTML.

Safe single-line math is preserved verbatim, including fractions, superscripts, `\lvert`/`\rvert`, `\lVert`/`\rVert`, `\mid`, existing `\|` norms, and matrices using TeX `\\`. Bare pipes such as `$|x|$` and `$P(A|B)$`, actual newlines inside math, TeX comments/verbatim commands, and incomplete delimiters are refused before saving; the complete draft remains editable. Use explicit TeX commands for the intended pipe symbol, and `\$` for a literal dollar sign. Rejected edits do not navigate or append a row. Interrupted drafts can be recovered within the current plugin session; this is not persistent storage across restarts. Formatting preserves existing math source and does not guess whether an old norm was intended as an absolute value.

Desktop whole-table image export is available from the source command palette, owned table menus and native ordinary-table menus. Its modal first generates a complete theme/background snapshot, then previews the final PNG with Copy image and Save PNG to Vault actions sharing the same bytes. It excludes active cell drafts and controls, leaves Markdown untouched, and keeps a completed snapshot stable. Source or theme changes during generation require a retry. Clipboard denial leaves Vault saving available. Mobile shows a desktop-only explanation. Fixed 2× output is limited to 8192 pixels per side and 16 megapixels; resource/render failures, timeouts and interactive or note embeds produce explicit errors rather than clipped or incomplete success.

<!-- section: base-promotion -->
## Convert to Base

Ordinary tables show **Upgrade to Base…** and structural tables show **Expand structure and upgrade to Base…**. Conversion is available only for valid tables in saved notes and requires the Bases core plugin.

### Preview

Before confirmation, show:

- target folder and record count;
- display-column to final Property-key mapping;
- generated Base source;
- how multi-row headers, merged column headers, row headers, and merged row headers will be flattened;
- blockers such as merged data cells;
- content/display differences such as `<br>` handling;
- prepared record paths and frontmatter.

If a display difference requires user judgment, confirmation remains disabled until the user explicitly accepts it. Cancelling or closing the preview creates no files.

### Properties and records

Use non-empty headers as Property keys when possible; blank headers become `column_n`. Duplicate or reserved names receive numeric suffixes. Records use the `structural-tables` list Property for membership, independent of their folder, and require no plugin-specific record ID.

The generated directory is only the initial creation location. Moving or renaming a record later must not break its Base membership.

### Writes and failures

Recheck blockers, source identity, and the editor target before writes. Replace the source table only after records and the recovery manifest are created and the original table is still unchanged.

On partial failure, keep created files and report the folder. Do not automatically delete content that a user or sync client may already have changed.

### Restore and legacy migration

Restore uses the original snapshot stored in `_promotion.json` and deliberately keeps generated record notes. Missing manifests, mismatched sources, or ownership that cannot be proven uniquely must be refused.

Legacy-property migration runs only on explicit user request. Its preview lists per-file changes, retired record-ID cleanup is off by default, and writes recheck both source and plugin-owned frontmatter. Rollback restores only plugin-owned changes and preserves unrelated concurrent edits.

<!-- section: table-selection -->
## Table selection and context menus

### Row and column handles

- On pointer devices, hovering a cell reveals only its matching row and column handles.
- Keyboard-focused or selected handles stay visible.
- Touch handles remain large enough to tap and must not cover preceding text.
- Handles live outside the table box and must not change table alignment.
- Clipped Callouts reserve a compact, stable editing gutter for handles; touch targets retain their larger gutter. Reading view needs no editing gutter.
- Add-row controls sit below the scroll viewport, including its horizontal scrollbar, and follow viewport resizing.
- Cells, row handles, and column handles each expose one Tab stop per group; arrow-key movement stays within the group and horizontal movement follows RTL direction.

### Selection and drag

Mouse drag creates a rectangular cell selection. Touch selects a rectangle by tapping its first and last cells. A completed touch selection must remain intact when the user long-presses inside it.

Row/column reordering is a two-step interaction: first select handles, then drag the selected handles. A move must include complete merged regions and stay on the same side of column-header/data and row-header/data boundaries. Invalid destinations show a blocked state and leave source unchanged. Escape, pointer cancellation, leaving the table, or source replacement cancels safely.

### Menu operations

Owned Live Preview menus group actions in this order: selected-cell Copy/Cut/Paste; available Merge/Split and header roles; rows; columns; column alignment; whole-table Word/HTML copy and PNG export; source and Base; Clear selected cells; Delete table. Whole-table outputs share a group. Row and column deletion stays last in its respective group, while Delete table has its own final group and warning styling.

Column alignment shows a check only when all selected columns have that alignment; mixed alignment has no check. Header-role actions omit setting the current number of header rows or columns, while eligible header removal remains available. Opening a menu freezes the logical selection; activation revalidates it before acting.

A rectangular multi-cell selection can merge; a single merged cell can split. Refuse a merge when non-top-left cells contain data, when the selection crosses roles, or when it includes only part of an existing merge.

Whole rows from the top can become column headers. Selecting the complete current column-header area can **Remove column headers** while preserving all text; this is separate from deleting rows. Whole left-side columns can set row-header roles. With a complete column selected, **Remove row-header columns from the whole table** removes all row-header roles while preserving every cell's content.

Ordinary GFM keeps Obsidian's native menus and handles while takeover is disabled; the plugin contributes its applicable items. Reading View keeps its brief whole-table PNG entry.

<!-- section: diagnostics -->
## Diagnostics

Invalid structures get a red edge and a readable reason. Reading view keeps its original table, and the editor never conceals invalid source.

<!-- section: settings -->
## Settings

Use native Obsidian controls with **General**, **Views**, and **Appearance** tabs. A failed save remains visible with a **Retry** action. If a future incompatible schema is detected, keep navigation available but disable controls that could overwrite those settings.

### General

- language: Follow Obsidian, English, Simplified Chinese;
- HTML-table paste conversion;
- warnings about overlapping table-plugin syntax.

### Views

- Reading view;
- Live Preview;
- invalid-structure diagnostics;
- default-off **Take over ordinary Markdown tables**.

The takeover description must make clear that source remains standard GFM, disabling the option restores native tables, and other table plugins may conflict.

### Appearance

Fresh installs follow the theme. Style, layout, and density are independent:

- **Follow theme** leaves borders, header fill, and typography to the active Obsidian theme. The theme's top outer border also applies to tables without column headers, including row-header-only tables;
- **Grid** gives column, row, and corner headers one restrained header treatment, with a slightly thicker single rule below the complete column-header area and along the row-header divider declared by `||`. Both declared boundaries remain visible in header-only tables. These rules follow merged-cell edges; tables without headers keep a uniform grid;
- **Three-line table** draws top/bottom rules and one rule below the complete column-header area, without a row-header fill or vertical divider;
- headerless Three-line tables naturally keep only top and bottom rules;
- explicit column alignment overrides the default row-header alignment.

Layout changes table position and width only. Appearance settings never rewrite Markdown.
