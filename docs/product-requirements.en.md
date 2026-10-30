---
doc_id: product-requirements
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-10-24
translation_of: product-requirements.zh-CN.md
---

[简体中文](product-requirements.zh-CN.md)

# Structural Tables — Product requirements

<!-- section: purpose -->
## Purpose

Let users express merged cells, multi-row column headers, and row headers with readable pipe-table Markdown, with dependable Obsidian rendering and safe editing.

<!-- section: syntax -->
## Syntax contract

An exact `<` merges with the previous source column (visually right in RTL tables), `^` merges up, and `\<` or `\^` is literal text. Every delimiter cell follows GFM and contains one or more hyphens. Contiguous equal-width rows before the delimiter are column headers. At most one whitespace-free `||` inside the delimiter marks columns to its left as row headers and does not add a column.

The optional GFM-compatible source dialect instead keeps its pipe-table delimiter in the second physical line. A complete `<<` control column (with a normal hyphen separator cell) marks the preceding real source columns as row headers; a complete `^^` control row marks all preceding real rows as column headers. With `^^` in the first physical row, there are no column headers. At the control intersection, use `<<`. Control cells have no logical row or column. Preserve the source dialect when editing and formatting; the default for new/imported tables is compatible, while older sources remain unchanged. Explicit source conversion previews the change and cannot discard real cells.

<!-- section: validity -->
## Validity

Every structural row has exactly the delimiter width. A merge resolves to one top-left content anchor, forms a complete rectangle, stays in bounds, and cannot cross corner-header, column-header, row-header, or data regions. Invalid source is retained without guessing or automatic repair.

<!-- section: capabilities -->
## Capabilities

Reading view and Live Preview rendering on desktop and Android; default-native ordinary GFM tables with an opt-in, reversible takeover mode that changes no Markdown; in-place cell editing with table-safe Wiki-link pipe escaping and IME protection; mouse drag selection plus two-tap rectangular selection on touch screens, with owned selection cleared when focus or the editor cursor leaves; roving keyboard navigation; overlaid row/column handles that do not shift table alignment and remain touch-sized and visible on coarse pointers; native theme styling with optional grid and three-line presets; content-driven fine-pointer row sizing, coarse-pointer touch minimums, and span-aware table borders; insert, safe delete, move, align, format, merge left/up, rectangular-selection merge, split, header setting, and note validation; integration with Obsidian's native ordinary-table selection and context menu; HTML-table paste with rowspan/colspan preservation; semantic HTML, plain GFM, TSV, and CSV output; Sheets Extended separator migration and conflict warnings; right-click Base upgrade for ordinary and structural tables; an explicit preview that preserves non-empty numeric and text header paths as Property names, reserves `column_n` for blank headers, flattens multi-row/merged column headers, turns row headers into properties, and blocks merged data cells before any file is written; path-independent `structural-tables` list membership without per-record plugin IDs, a recovery manifest, table restoration that keeps records, later-record creation beside the host's current folder, and an explicit previewed legacy-property migration; native settings in twelve languages; and explicit diagnostics. Canonical formatting is previewed and explicitly confirmed before replacing Markdown source; other structural edits are explicit actions. Rendering never changes source.

Plain GFM conversion shares the existing pure transpose and projection logic. For row-header-only input it recommends transpose, with an explicit keep-orientation option. The actual result and its Markdown source can be previewed, copied, or applied as one undoable editor replacement. Reading View can copy without a source-writing path; stale targets and active drafts are refused. The preview explains merged-cell expansion and header-role changes before a write.

Desktop whole-table image export previews the final theme/background PNG. Preview, image copy, and saving to the Vault use the same generated PNG. It preserves semantic spans, renders supported cell text/math and loaded local images, includes full wide/tall content within explicit resource limits, excludes editing controls and drafts, and never writes Markdown or uploads the table. Unsupported mobile image operations and dynamic embeds are explained rather than silently degraded.

<!-- section: exclusions -->
## Exclusions

The plugin does not provide spreadsheet-style formula calculations; safe TeX math source is preserved subject to the cell-safety rules. It excludes per-cell styling, block or true multiline content, captions and numbering, repeated-header source attributes, and automatic rich-text-to-Markdown conversion inside imported HTML cells. Exact `<br>`, `<br/>`, and `<br />` spellings remain ordinary cell text that Obsidian renders as a visual line-break workaround; the plugin preserves rather than models or normalizes them. Base promotion does not guess record semantics for merged data cells, replace the native Bases New button, or delete generated or later-moved record notes during restoration.

<!-- section: success -->
## Acceptance

Pure-core tests cover positive, negative, and canonical serialization cases; packages are reproducible and offline; real Obsidian acceptance stays distinct from automation. Mobile interaction or shared runtime behavior affecting mobile requires representative Android emulator acceptance on the exact candidate; other changes record the reason for omission. Confirmed serious product defects affecting a release block that release. Missing host/tool evidence stays unverified and is assessed by risk; it does not automatically block publication or add a separate approval step. Untested scope cannot be claimed as passed. Android physical devices and iOS are out of scope.
