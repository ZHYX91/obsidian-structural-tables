# Changelog

## Unreleased

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
