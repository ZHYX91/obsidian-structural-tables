# Changelog

## Unreleased

- Keep full touch row handles inside the visible text column and reserve column-handle space after table captions, including tables inside Callouts.
- Acquire native Callout tables adopted into separate editor windows, and render complete source-verified table blocks containing inline images while retaining note-embed and partial-paragraph protections.
- Follow the theme's top outer border for tables without column headers, including row-header-only and merged tables.
- Give Grid tables slightly thicker single borders at semantic header boundaries, retaining declared column- and row-header boundaries before data rows are added and preserving merged cells and a uniform grid for tables without headers.
- Keep the add-row control below horizontal scrollbars as the viewport resizes, with compact desktop control gutters and unchanged touch targets.
- Improve owned-table editing with plain-text pointer caret placement, Enter/Arrow/Shift-range navigation, theme-aware selection styling, frozen menu selection context, and bounded exact-topology range copy/cut/paste.
- Clear owned grid selections with Delete/Backspace while reserving row, column, and whole-table removal for explicit context-menu actions with host undo/redo.
- Keep Cmd/Ctrl+B and Cmd/Ctrl+I inside active cell drafts, preserve nested bold/italic markers, and route typing, composition, paste, line breaks and formatting through draft-local undo/redo until explicit commit.
- Preserve source selections when opening external controls, and offer an explicit cell-to-source editing handoff.
- Render source-verified merged tables in standalone Markdown export containers and finish cell content before exporters clone the result.
- Retain third-party postprocessor and detached-editor protections, and clarify the limits of source-based table commands.
- Preserve Callout text around wrapped tables and leave ambiguous Reading View or export targets untouched.
- Keep recovered legacy Base links connected during property migration, with manifest verification and rollback.
- Protect fenced examples nested in lists and quotes, and avoid argument-count limits on large merged tables.
- Preserve heading boundaries and inherited whitespace in HTML paste through safe plain-text fallback.
- Release native table menu resources when cells or windows close, and preserve right-clicked row/column ranges.
- Refresh settings labels after a successful save retry and include the bundled dependency license in the runtime asset.
- Create Reading view, export and native-comparison containers in their target document, preserving separate-window DOM constructors.

## 0.5.2 - 2026-10-03

- Keep focus on external controls after an IME edit is rejected, while preserving recoverable drafts, hidden GFM source, and temporary cell-menu focus restoration.
- Clarify table-formatting preview text in English and Chinese.

## 0.5.1 - 2026-10-03

- Prevent rejected cell drafts in separate tables or panes from competing for focus while keeping each draft recoverable and preserving hidden GFM source.
- Keep ordinary GFM tables native when only hidden extra cells contain merge markers, while preserving hidden content during rejected edits.
- Make generated Base record filename collision checks independent of the system locale and simplify Base command labels.
- Rewrite English and Chinese user guidance and expand coverage reporting to all production source modules.

## 0.5.0 - 2026-10-02

- Support headerless tables, including a single data row and row headers; remove column-header roles without deleting cell content.
- Preserve headerless HTML-table imports and CSV/TSV exports; plain GFM conversion uses an empty compatibility header.
- Accept short GFM delimiter cells and ragged ordinary table rows. Keep tables with hidden extra source cells read-only across editing, merge, header-role, format and migration operations.
- Give Grid semantic headers a consistent fill and weight, and Three-line headers restrained typography; preserve explicit alignment, selection feedback and Follow theme styling.

## 0.4.14 - 2026-10-01

- Render multi-row and row-header tables across native Reading View block boundaries while preserving surrounding prose, links and media.
- Track owned reading sections through render-child lifetimes instead of relational CSS selectors, and simplify settings tab styling.
- Preserve document ownership when creating editor and reading nodes through Obsidian DOM helpers.
- Update the bundled YAML parser and development dependencies while retaining the host-compatible CodeMirror commands and shared state pins.

## 0.4.13 - 2026-09-30

- Drag the complete highlighted row or column group when selection expands through merged cells, while preserving header-boundary protection.
- Patch vulnerable development dependencies without changing the plugin's runtime dependency set.

## 0.4.12 - 2026-09-30

- Offer explicit cell-editor menu rewrites for simple absolute-value and conditional-probability formulas containing bare pipes; save only after the user selects the intended TeX spelling.
- Keep complex TeX and escaped boundaries in the draft without a rewrite, and refuse stale suggestions or confirmation during input-method composition.
- Dismiss cell-editor menus with Escape without cancelling the underlying draft.
- Preview break-related Base-promotion content as exact source strings and generated record frontmatter; require one-time acceptance before writes when display semantics may differ.
- Keep Base-promotion mappings, content details, and record previews visible in mobile dialogs.
- Keep Callout table header borders consistent with the contextual table border color.

## 0.4.11 - 2026-09-28

- Keep table parsing, cursor positioning and cache invalidation consistent across code spans, comments, math blocks and list containers.
- Refuse edits and imports that would truncate a table; retain rejected drafts. Preserve safe single-line math and reject math inputs that cannot be represented without changing their meaning.
- Preserve complete clipboard content, falling back to original Markdown for formulas, images and internal references.
- Migrate global and view-level Base membership filters without changing unrelated YAML values; preserve rollback fields and bind asynchronous promotion/restoration to the source editor and preview.
- Defer cell Markdown rendering and retain Callout ownership during detached editor mounts to prevent repeated mounting with third-party post-processors.
- Keep Reading View cell rendering owned by the replacement table so list tables do not remain empty after their source block is replaced.
- Show add-row and add-column controls during desktop hover or keyboard focus, and while a touch table is active.

## 0.4.10 - 2026-09-23

- Preserve generated folders and partial records after failed Base promotion so concurrent edits and unrelated additions are never swept into automatic cleanup.
- Report the retained folder path and original failure for manual review.
- Cover late concurrent edits, file replacement and partial-write failures with regression tests, and add a disposable-Vault promotion recovery scenario.

## 0.4.9 - 2026-09-20

- Revalidate Base restoration after asynchronous reads and reject changed or ambiguous targets.
- Keep rejected cell edits open and recover interrupted drafts after view replacement through a copyable, session-scoped recovery dialog.
- Remove inferred native Base record adoption; only the explicit plugin command creates records in the host inbox.
- Unify pipe/backtick syntax handling and preserve pasted fragments until whole-cell commit.
- Localize diagnostics with document line numbers and reuse safe CJK prose parsing snapshots.
- Keep keyboard navigation and visible column-handle Tab entries reachable in wide tables.
- Bound long-draft editor height, explain blocked reordering, and continue horizontal edge scrolling while dragging.

## 0.4.8 - 2026-09-13

- Add bottom and right edge controls for new rows and columns, with focus in the new cell.
- Append a data row when Tab leaves the final visible cell, committing the draft and insertion together for undo.
- Reorder explicitly selected rows or columns by dragging their handles; support Shift-click and touch range selection.
- Preserve content, alignment and container prefixes while refusing drops that split merged cells or cross header boundaries.
- Handle soft-keyboard Enter before a line break can replace selected cell text.

## 0.4.7 - 2026-09-13

- Match Callout tables to their source in both views using native-rendered content, including rich row headers and multiple header rows.
- Preserve the correct edit destination across nested Callouts, mixed tables and identical tables; leave ambiguous targets untouched.
- Restore cell focus after asynchronous Callout rendering so commits and undo/redo do not expose the entire Callout source.
- Retain Callout cell targets in the host history so mobile command-palette undo and redo return to the edited table.
- Move the native caret to the table when splitting its last merged cell, avoiding a mobile jump to an unrelated source position.

## 0.4.6 - 2026-09-12

- Render structural tables inside blockquotes and callouts, and preserve container prefixes through formatting, cell edits, structural operations, and GFM replacement.
- Preserve list continuation indentation while excluding nested code examples; refuse nested Base promotion before any writes.
- Keep YAML block scalars protected and parse LF, CRLF, and CR with exact source offsets.
- Reuse parsed tables for safe plain-paragraph edits in Live Preview, retaining full parsing for structural changes.
- Update the release transport to recover from temporary GitHub read failures and resume verified drafts.

## 0.4.5 - 2026-09-08

- Fix promoted Base columns and sorting by using property IDs instead of formula expressions, including numeric, Unicode, whitespace and escaped property names.
- Preserve promotion identity as YAML configuration through native Base saves; keep legacy comment compatibility and verify unmarked Base recovery against its original manifest before writes.

## 0.4.4 - 2026-09-06

- Retain the portable clipboard styling fix and its enforced lint checks.
- Publish through a reproducible CI build with verified artifact provenance, independently of optional host acceptance.

## 0.4.3 - 2026-09-06

- Apply portable clipboard styles through Obsidian's DOM helper while preserving Word table borders, spacing, and column alignment.
- Enforce the static-style assignment lint rule for clipboard rendering as part of local and release checks.

## 0.4.2 - 2026-09-05

- Preserve column widths and row heights while editing long or merged cells by keeping rendered content in layout beneath the editor.
- Keep empty cells at least one line tall under theme-following density so their editors fit within the row.
- Apply density and touch minimums to logical rows, including rows fully covered by merged cells, so row handles retain usable spacing.
- Preserve completed touch selections during long press so merge and other range actions remain available; start a new range by tapping outside it.
- Keep compact and comfortable Live Preview cells at the touch minimum so adjacent row handles do not overlap on mobile.
- Copy complete tables for Word with semantic merges, portable inline formatting, grid/three-line borders, and readable plain-text clipboard fallback; add an explicit whole-table context-menu action.
- Restore keyboard focus after structural menu edits so undo/redo remains immediately available.
- Import Excel clipboard fragments without outer table tags, preserve the first complete header span group, and paste single-cell line breaks without TSV quotes or trailing record separators.
- Restore cell focus after committing an edit and support document undo/redo from the focused table cell without intercepting draft history.
- Own F2 while a table cell is focused so Obsidian's rename shortcut cannot intercept cell editing.
- Clarify nested column headers in three-line tables with inset group rules that respect row spans and leave the body unruled.
- Reserve space above Live Preview tables for touch-sized column handles so they do not cover preceding text.
- Keep Live Preview row and column handles visible outside Obsidian's widget paint containment.
- Add theme-following, grid, and three-line table styles independently of width and density; preserve existing explicit preferences.
- Keep owned table blocks inside the text column with local horizontal scrolling, and align merged-cell edge styling with theme table tokens.
- Handle Escape in an Obsidian cell-edit scope so cancellation retains the rendered table instead of focusing raw source.
- Preserve in-place drafts and current source bindings when text or other tables are inserted before an unchanged table.
- Traverse visible merged-cell anchors consistently with Tab and Shift+Tab, and leave composition keys to the active cell editor.
- Reuse parsed tables during selection and settings updates instead of reparsing the whole note.
- Bind richly formatted row-header blocks to their source lines and preserve later native tables when a raw block cannot be mapped.

## 0.4.1 - 2026-09-05

- Bind each Reading View replacement to Obsidian's reported source-line range so later ordinary tables cannot be replaced with an earlier structural table.
- Render structural source containing Wiki-link aliases and inline-code pipes after Obsidian turns those fragments into inline DOM elements.
- Keep in-place cell editing within the existing column and show one clear outer focus border without an inner textarea border or resize grip.
- Align Markdown pipe columns after explicit table writes using display width for CJK and emoji while preserving row-header dividers, alignment markers, escaped pipes, Wiki links, code spans, and the note's line endings.
- Keep empty and merged tables at stable comfortable or compact cell dimensions instead of collapsing after structural edits.
- Reveal the corresponding row and column handles when a desktop pointer is over a cell, while keeping the handles outside the table layout for native alignment.
- Insert a canonical `<br>` while editing with Shift+Enter or the cell editor's context menu, and preserve browser or spreadsheet cell line breaks through HTML import and export.
- Ignore promoted-Base examples nested inside longer Markdown fences and make migration rollback preserve unrelated concurrent note edits.
- Keep the legacy-migration preview's retired-ID counts and per-file actions synchronized with its opt-in cleanup toggle.
- Preserve non-empty table headers, including numeric and leading-zero headers, as promoted Base Property names; use bracket notation for generated references and reserve `column_n` for blank headers.
- Keep legacy promoted Bases that use dot-notation Property references recognizable without migrating existing records.
- Correct merged-cell border edges, use content-driven desktop row sizing with coarse-pointer touch minimums, and let alternating row backgrounds continue through row spans.
- Reduce owned-table keyboard tab stops with arrow-key cell and handle navigation, plus explicit focus rings.
- Clear owned cell and handle selections when focus or the editor cursor leaves the table, including when another table receives the pointer.
- Overlay row and column handles outside table layout so they no longer shift content alignment.
- Recognize promoted Base blocks across LF, CRLF, and CR endings and protect Windows device-name stems even when they include an extension.
- Make retired-record-ID cleanup opt-in and membership-scoped, show per-file migration actions, and reject concurrent source changes immediately before Base rewrites.

## 0.4.0 - 2026-09-03

- Store promoted Base membership in the Obsidian-friendly `structural-tables` list Property.
- Stop assigning plugin-specific IDs to record notes and remove record IDs from new recovery manifests.
- Keep legacy `structural_table_ids` Bases working while rejecting malformed or conflicting dual membership metadata.
- Add an explicit Vault-wide migration with affected-file preview, stale checks, optional `structural_record_id` cleanup, and rollback after a failed write.
- Render row-header tables containing `<br>`, `<br/>`, or `<br />` correctly in Reading View.

## 0.3.1 - 2026-09-02

- Start editing rendered cells with a single desktop click while preserving drag selection, links, and touch behavior.
- Make Android double-tap cell editing independent of WebView native double-click timing.
- Preserve `<br>`, `<br/>`, and `<br />` spelling while using each as a visual line break in rendered tables.
- Preview and explicitly confirm canonical table formatting before replacing Markdown source.
- Protected settings that use an unknown or malformed schema from being overwritten.
- Serialized settings saves with retryable failure status and unload flushing.

## 0.3.0 - 2026-08-28

- Support Android Obsidian while retaining the existing desktop interaction model.
- Add two-tap rectangular selection on touch screens without suppressing horizontal scrolling or long-press menus.
- Keep row and column handles visible at a 44-pixel touch target on coarse-pointer devices.
- Use current-candidate emulator evidence as the mobile release gate while reporting physical Android separately.

## 0.2.0 - 2026-08-26

- Preserve supported HTML table row and column spans when pasting from browsers and spreadsheets.
- Copy valid tables as semantic HTML, portable GFM, TSV, or CSV.
- Preview and explicitly confirm flattening a structural table to ordinary GFM.
- Flatten multi-row header paths deterministically and repeat merged values in portable tabular output.
- Convert one unambiguous Sheets Extended separator column into canonical row-header syntax.
- Warn once when enabled table plugins are known to own overlapping structural syntax.
- Add settings for HTML-table paste conversion and startup conflict warnings.
- Promote a valid table into an embedded Obsidian Base backed by one Markdown note per data row.
- Keep Base membership and record identity independent of note paths and file names.
- Preview Base property flattening, target files, warnings, and blockers before changing the note.
- Create records and a schema-versioned recovery manifest before replacing the table, with cleanup on failed promotion.
- Restore the original table without deleting generated, moved, renamed, or edited record notes.
- Create later Base records beside the host note's current folder.
- Register records created with a generated Base's native New action and organize them under the host note's current record inbox.
- Offer Base upgrade from ordinary-table and structural-table context menus while refusing ambiguous merged data cells.
- Default to content-aligned tables, theme-aware borders and header backgrounds, and handles visible only for the active row or column.
- Add an opt-in setting that gives ordinary GFM tables the Structural Tables editor and appearance without changing their Markdown.
- Restore Obsidian's native ordinary-table behavior immediately when ordinary-table takeover is disabled.
- Keep Upgrade to Base available in Obsidian's native table menu when ordinary-table takeover is disabled.
- Keep schema-version 1 recovery manifests readable regardless of the plugin version that created them.

## 0.1.0 - 2026-08-25

- Add Live Preview in-place cell editing with Enter/Escape/Tab, IME protection, and table-safe Wiki-link pipe escaping.
- Add whole-row and whole-column handles plus safe insert, delete, move, and alignment menu actions for rendered structural tables.
- Fit new structural tables to the note pane by default and enforce practical minimum cell widths.
- Add left, centered, and current-pane-width table layouts while migrating the previous width setting.
- Align settings with General, Views, and Appearance tabs and label automatic language as Follow Obsidian.
- Add native editor context-menu actions for rectangular merge, split, column-header rows, and row-header columns.
- Bridge Obsidian's native table selection menu and provide direct drag selection on rendered structural tables.
- Allow merge and header actions to bootstrap structural syntax from an ordinary GFM table.
- Preserve content and reject selections or header boundaries that would create an invalid structure.
- Establish the structural table syntax and strict validation model.
- Add Reading view and Live Preview rendering.
- Add insert, format, merge, split, and validation commands.
- Add bilingual settings and documentation.
