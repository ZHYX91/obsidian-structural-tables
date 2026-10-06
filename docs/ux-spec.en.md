---
doc_id: ux-spec
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-10-02
translation_of: ux-spec.zh-CN.md
---

[简体中文](ux-spec.zh-CN.md)

# Structural Tables — UX specification

<!-- section: principles -->
## Principles

Source remains visible and recoverable; rendering interprets but never rewrites; an operation that could lose content is refused.

<!-- section: live-preview -->
## Live Preview

A valid structural table is presented by a semantic block widget while its Markdown remains authoritative in the CodeMirror document. When the native CodeMirror source surface owns focus and its selection intersects the table, raw Markdown is shown for direct editing; opening an external control preserves that source-editing session and its exact selection. Visual cell interactions synchronize the logical source position without leaving presentation mode. **Edit table source** explicitly hands focus and the mapped cell position back to CodeMirror.

### Cell editing

- Desktop click, touch double-tap, or Enter/F2 opens the editor.
- The editor overlays the existing cell without changing column width or adding a second visible input border.
- Enter commits, Escape cancels, and Shift+Enter inserts a draft line break.
- Tab/Shift+Tab follows visible cells in source order and skips covered merge slots.
- While the textarea owns editing focus, Cmd/Ctrl+B and Cmd/Ctrl+I toggle bold/italic only on its current draft selection and preserve the other emphasis style. Typing, composition input, paste, draft line breaks, and these format operations participate in one draft-local undo/redo history; inherited main-editor history and formatting commands must not touch saved source before commit. Other formatting commands remain source-oriented and require **Edit table source**.
- A rejected commit keeps the complete draft, does not navigate, and does not append a row.
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

When Preserve pasted HTML table spans is enabled, a verifiable multi-column table is converted structurally.

A single otherwise-safe table that is either completely empty or contains only text semantics the importer cannot preserve faithfully (`pre`, `sup`, or `sub`) uses the complete non-empty plain-text clipboard alternative verbatim when available; no TSV, Markdown, or TeX equivalence is inferred. If that known-lossy payload has no plain-text alternative, the paste is blocked and the current selection is kept.

Mixed-content, multi-table, image, HTML `embed`, attachment, link, MathML/SVG, rich semantics on or around the table, clipboard files, and non-text clipboard MIME payloads remain native paste rather than being downgraded to plain text.

Ordinary `div`/`span` wrappers and additional `text/*` MIME representations do not by themselves disable the narrow plain-text fallback.

A thead or consecutive th rows become column headers, consecutive leftmost th columns in the body become row headers, and rowspan/colspan become canonical `^`/`<` markers.

Cell content is imported as plain text, with HTML break and block boundaries normalized to canonical `<br>` visual breaks.

Plain GFM, TSV, and CSV output repeats merged values and joins multi-row header paths with ` / `; HTML output preserves semantic roles, spans, scope, and break elements.

HTML conversion accepts one complete supported table only. Mixed prose, multiple tables, captions, math, images, attachments, and links that cannot be preserved are left to native note paste. In a cell editor, unsupported HTML uses the complete plain-text alternative with a notice; if none exists, the current edit remains intact. A verified empty cell can still clear the selected text. HTML copy falls back to original Markdown/LaTeX for math, images, attachments, and internal or relative links, preserving references without embedding arbitrary HTML.

Safe single-line math is preserved verbatim, including fractions, superscripts, `\lvert`/`\rvert`, `\lVert`/`\rVert`, `\mid`, existing `\|` norms, and matrices using TeX `\\`. Bare pipes such as `$|x|$` and `$P(A|B)$`, actual newlines inside math, TeX comments/verbatim commands, and incomplete delimiters are refused before saving; the complete draft remains editable. Use explicit TeX commands for the intended pipe symbol, and `\$` for a literal dollar sign. Rejected edits do not navigate or append a row. Interrupted drafts can be recovered within the current plugin session; this is not persistent storage across restarts. Formatting preserves existing math source and does not guess whether an old norm was intended as an absolute value.

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
- Cells, row handles, and column handles each expose one Tab stop per group; arrow-key movement stays within the group and horizontal movement follows RTL direction.

### Selection and drag

Mouse drag creates a rectangular cell selection. Touch selects a rectangle by tapping its first and last cells. A completed touch selection must remain intact when the user long-presses inside it.

Row/column reordering is a two-step interaction: first select handles, then drag the selected handles. A move must include complete merged regions and stay on the same side of column-header/data and row-header/data boundaries. Invalid destinations show a blocked state and leave source unchanged. Escape, pointer cancellation, leaving the table, or source replacement cancels safely.

### Menu operations

A rectangular multi-cell selection can merge; a single merged cell can split. Refuse a merge when non-top-left cells contain data, when the selection crosses roles, or when it includes only part of an existing merge.

Whole rows from the top can become column headers. Selecting the complete current column-header area can **Remove column headers** while preserving all text; this is separate from deleting rows. Whole left-side columns can add or remove row-header roles.

Ordinary GFM keeps Obsidian's native menus and handles while takeover is disabled.

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

- **Follow theme** leaves header fill and typography to the active Obsidian theme;
- **Grid** gives column, row, and corner headers one restrained header treatment;
- **Three-line table** draws top/bottom rules and one rule below the complete column-header area, without a row-header fill or vertical divider;
- headerless Three-line tables naturally keep only top and bottom rules;
- explicit column alignment overrides the default row-header alignment.

Layout changes table position and width only. Appearance settings never rewrite Markdown.
