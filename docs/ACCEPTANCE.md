# Acceptance

Automated checks prove source-level behavior and package integrity. They do not prove behavior in a real Obsidian host.

When one note contains multiple tables, verify in Reading View that every native and owned table is rendered from its own reported source-line range rather than from an earlier table in the note.

For a full optional regression, test the packaged candidate in an explicitly named disposable Vault on the minimum supported Obsidian version and the current stable version. Select the modules affected by the change; a full regression covers the complete checklist.

### Rendering and cell editing

- [ ] Reading view.
- [ ] Live Preview desktop single-click, touch-screen double-tap, and Enter/F2 cell editing with one outer border, no inner textarea border or resize grip, and no table/column expansion.
- [ ] Exact `<br>`, `<br/>`, and `<br />` visual rendering plus spelling preservation through format preview.
- [ ] Shift+Enter and the cell-editor context menu inserting canonical `<br>`.
- [ ] Enter/Escape/Tab, multiline paste, undo/redo, English and Chinese IME.

### Clipboard and source formatting

- [ ] Pasted Wiki links and embeds with escaped pipes.
- [ ] Browser/Excel HTML-table paste with row/column spans, in-cell line breaks, and escaped pipes, plus disabled pass-through.
- [ ] Explicit-write source-pipe alignment by display width across ASCII, CJK, emoji, row-header `||`, alignment markers, escaped pipes, Wiki links, code spans, and LF/CRLF/CR while rendering alone makes no write.
- [ ] HTML/GFM/TSV/CSV clipboard output including semantic HTML break elements.

- [ ] GFM preview confirm/cancel/stale refusal.

### Bases and migration
- [ ] Sheets Extended migration and conflict warning.
- [ ] Bases-disabled upgrade refusal.
- [ ] Ordinary and structural right-click Base-upgrade labels.
- [ ] The explicit multi-row/merged-header and row-header flattening preview.
- [ ] Numeric, leading-zero, canonical-duplicate, reserved, and blank header promotion with bracket references and legacy dot-reference recognition.
- [ ] Windows reserved filename stems with and without extensions.
- [ ] Promoted Base recognition and migration under LF, CRLF, CR, tilde fences, and longer-fence examples.
- [ ] Visible merged-data blocker text, exact coordinates/spans, disabled confirmation, and zero writes.
- [ ] Upgrade confirmation and failure cleanup.
- [ ] `structural-tables` list membership without a per-record identity property.
- [ ] Path-independent results after rename/move.
- [ ] Later-record creation after moving the host note.
- [ ] Native Base New organization into the current host inbox with collision suffixing, preservation of user moves, and fail-closed ambiguity, invalid/conflicting metadata, or move failure.
- [ ] Previewed per-file legacy-property migration with toggle-synchronized counts, default-off membership-scoped `structural_record_id` cleanup, stale and concurrent-change refusal, and rollback that preserves unrelated concurrent edits.
- [ ] Restoration that keeps records.
- [ ] Missing-manifest refusal.

### Ownership, geometry and interactions

- [ ] Source mode preservation.
- [ ] Every command.
- [ ] Ordinary-table native cell/row/column selections and menus while takeover is disabled.
- [ ] Ordinary-table Live Preview and Reading view ownership, full menus, unchanged source, and immediate native restoration while the opt-in setting is toggled.
- [ ] Theme-following, grid, and three-line styles with logical merged edges.
- [ ] Span-aware outer borders, native-aligned table origin with handles outside layout, stable comfortable/compact cell dimensions and coarse-pointer touch minimums before and after merges, zebra continuity through row spans, selection clearing when focus/editor cursor leaves or another table receives the pointer, visible focus, one Tab stop per cell/row-handle/column-handle group, LTR/RTL arrow movement, and owned-table handles hidden at rest but revealed for the hovered cell's row and column or retained by keyboard focus/selection without clipping.
- [ ] Drag selection, insert/delete/move/alignment/merge/split/header menus.
- [ ] All four table layouts in narrow and split panes, with theme-following as the fresh default and owned blocks confined to the text column.
- [ ] Optional alternating rows.
- [ ] Refusal without content loss.
- [ ] Invalid-table diagnostics.
- [ ] Settings persistence.
- [ ] Light and dark themes.
- [ ] Plugin disable/uninstall cleanup.
- [ ] Conflicts with another table plugin.

## Android regression

When Android regression is selected, run the current packaged bytes in a named disposable emulator Vault and cover startup, Reading view, Live Preview, two-tap rectangular selection followed by a separate long press inside the completed range, starting a new range outside it, double-tap editing within it, long-press menus, touch-sized row/column handles, in-place editing, and Chinese/English IME composition. Record the AVD, OS/API, Obsidian version, candidate identity, and per-scenario result. Android physical devices and iOS are out of scope. Production-Vault deployment is separate and requires explicit authorization for the exact Vault.

## Scope and result recording

Host acceptance is a quality report, not a publication prerequisite. Quick checks cover plugin loading, rendering, edit/save and disable/restore. Targeted regression selects changed modules; full regression covers all scenarios. Keep rendering, editing/selection, theme/geometry, clipboard/format, and migration results separate. Record passed, product failure, tool failure, skipped and not-run accurately, with exact candidate, host, theme and observation scope. Repeating a module adds a new observation without rewriting earlier results.

The theme matrix is Default and Minimal, each in light and dark mode. Table appearance (Theme/Grid/Three-line), density and layout are separate dimensions. Use representative combinations and change-directed coverage instead of rerunning every combination for unrelated changes. Check long text and empty merged cells before/during/after editing, measuring table width, column boundaries and local/page overflow alongside visual inspection.
