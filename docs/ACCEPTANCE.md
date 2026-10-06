# Acceptance

Automated checks prove source-level behavior and package integrity. They do not prove behavior in a real Obsidian host.

When one note contains multiple tables, verify in Reading View that every native and owned table is rendered from its own reported source-line range rather than from an earlier table in the note.

For a full optional regression, test the packaged candidate in an explicitly named disposable Vault on the minimum supported Obsidian version and the current stable version. Select the modules affected by the change; a full regression covers the complete checklist.

### Rendering and cell editing

- [ ] Headerless tables with short and canonical delimiters, one or multiple data rows, row headers and merged cells render in both views and containers. Editing, insertion, header-role changes and undo/redo retain every data row and restore focus.
- [ ] Select the complete column-header region and remove its header role; all text remains as data. Header changes that split a merged cell are refused.
- [ ] Reading view.
- [ ] Callout mapping: custom and foldable callouts, rich row headers, multiple header rows, nested callouts, mixed ordinary/structural tables, identical tables, and list continuations in both views. Fenced examples and invalid syntax remain uneditable.
- [ ] Edit the second of two identical callout tables, commit and undo/redo; only the selected source table changes, quote prefixes remain, and focus returns to its rendered cell without revealing the whole callout source. Test Tab traversal, folding/reopening and view switching after edits.
- [ ] Live Preview desktop single-click, touch-screen double-tap, and Enter/F2 cell editing with one outer border, no inner textarea border or resize grip, and no table/column expansion. A provable plain-text pointer click places a UTF-16 caret at the clicked character (include A😀B); formatted/code/Wiki/entity/ambiguous rendering falls back to selecting the full draft. Editing cells retain theme header/zebra/background/borders instead of the multi-cell selection fill.
- [ ] Enter commits to the next logical row in the same column; terminal Enter edits and appends one row in one source/history transaction. Tab/Shift+Tab remains visible-anchor and merge-aware. Horizontal draft arrows cross cells only at a collapsed exact text boundary; Up/Down crosses only with stable single-visual-line textarea geometry. Text selections, modifiers, IME and uncertain geometry stay textarea-native.
- [ ] Shift+Arrow extends and shrinks the owned logical range from the original anchor/head through merge closure, including reverse shrink after crossing a merged owner and RTL horizontal direction. Range menus retain the frozen logical selection through menu focus transfer; a real external selection/source/session change invalidates deferred actions.
- [ ] Exact `<br>`, `<br/>`, and `<br />` visual rendering plus spelling preservation through format preview.
- [ ] Shift+Enter and the cell-editor context menu inserting canonical `<br>`.
- [ ] Enter/Escape/Tab, multiline paste, undo/redo, English and Chinese IME.
- [ ] With an active in-place cell draft, select draft text and trigger Cmd/Ctrl+B and Cmd/Ctrl+I through Obsidian's Scope path before textarea bubbling. Nested **bold**, *italic*, and ***combined*** emphasis must toggle only the requested style, including selecting the complete inner **bold** marker pair inside ***combined*** emphasis. Delimiter removal must also respect external flanking context using CommonMark-style Unicode punctuation classes (P or S): intraword forms such as `a*!*b`, `a**!**b`, `a*+*b`, `a*$*b`, and an equivalent Unicode-symbol case stay literal whether the markers or only their content are selected, while standalone `*!*`, `**!**`, `*+*`, and `*$*` still toggle as valid emphasis. Repeated same-format toggles, partial selections, collapsed selections, escaped stars, partial star runs, and whitespace-delimited literal text such as `* West *` must never discard visible stars; ambiguous delimiter selections may conservatively remain unchanged. The textarea stays active and saved Markdown/main-editor history stay unchanged until Enter commits. Typing, composition input, paste, Shift+Enter and B/I participate in one draft-local undo/redo history: verify typing → format → Undo twice, typing → format → more typing → Undo three times, Ctrl+Y / Mod+Shift+Z redo, and that new typing after Undo clears redo, all without invoking inherited main-editor history. The committed source change remains undoable from the main document. During composition, formatting shortcuts must not invoke an inherited editor command. Other formatting toolbar/command paths remain source-oriented.
- [ ] Unsafe bare math pipes keep the complete draft. For exact `$|x|$` and `$P(A|B)$` drafts, verify the cell-editor context menu offers the explicit `\\lvert … \\rvert` or `\\mid` rewrite, applies it only after user selection, preserves table geometry, and leaves complex TeX without an automatic rewrite.

### Clipboard and source formatting

- [ ] Ragged ordinary GFM rows render with empty missing cells. Hidden extra source cells prevent edits, merges, header changes, formatting, GFM replacement and migration; rejected drafts stay available and the complete source stays unchanged. Copy remains usable.
- [ ] Body-only HTML tables import without inventing a header. Headerless HTML has no empty thead, CSV/TSV include every data row, and plain GFM has an empty compatibility header.
- [ ] Pasted Wiki links and embeds with escaped pipes.
- [ ] Browser/Excel HTML-table paste with row/column spans, in-cell line breaks, and escaped pipes, plus disabled pass-through.
- [ ] Explicit-write source-pipe alignment by display width across ASCII, CJK, emoji, row-header `||`, alignment markers, escaped pipes, Wiki links, code spans, and LF/CRLF/CR while rendering alone makes no write.
- [ ] HTML/GFM/TSV/CSV clipboard output including semantic HTML break elements.
- [ ] Owned-grid range Copy writes a synchronous normalized v1 owner payload plus plain GFM and HTML without touching source. Cover ordinary rectangles, 1x1, one-column, all-empty, headerless/multi-header, horizontal/vertical/2D merges, raw bold/code/Wiki/math/<br>, and external GFM header conversion. Cut clears exactly once only after clipboard success and exact source/path/range/selection/session revalidation; clipboard failure, Promise rejection, selection/source/note/window/unload changes preserve source. Paste consumes unsupported/bad/stale payloads without hidden-source fallback and succeeds only for exact dimensions plus owner topology, preserving target roles/alignment/size/merge and unselected owners in one undoable write. Active textarea copy/cut/paste remains text-local.

- [ ] GFM preview confirm/cancel/stale refusal.

### Bases and migration
- [ ] Sheets Extended migration and conflict warning.
- [ ] Bases-disabled upgrade refusal.
- [ ] Ordinary and structural right-click Base-upgrade labels.
- [ ] The explicit multi-row/merged-header and row-header flattening preview.
- [ ] Base promotion with break-related content lists every affected source cell and generated target, final header key/displayName, actual record path/frontmatter, and source/target counts. Supported `<br>`, `<br/>`, `<br />` and case variants are distinguished from closed code, escaped/entity literals, math, HTML attribute/comment/raw-text, and unsupported spellings. Acceptance starts unchecked, cancel/close writes nothing, service refuses unaccepted execution, reopening resets acceptance, and confirmed records equal the preview.
- [ ] In the Base promotion content product scenario on desktop and Android emulator, confirm/reopen generated records, use host undo/redo controls without deleting records, then restore the original table while retaining generated records. Android does not depend on desktop keyboard shortcuts.
- [ ] Numeric, leading-zero, canonical-duplicate, reserved, and blank header promotion with property IDs, emoji/whitespace/dot/quote/backslash names, and legacy expression-order recognition.
- [ ] Windows reserved filename stems with and without extensions.
- [ ] Promoted Base recognition and migration under LF, CRLF, CR, tilde fences, and longer-fence examples.
- [ ] Visible merged-data blocker text, exact coordinates/spans, disabled confirmation, and zero writes.
- [ ] Upgrade confirmation and retained output after failure: partial records, concurrent edits, unexpected children and replacement folders remain untouched; the error includes the folder path and original cause.
- [ ] `structural-tables` list membership without a per-record identity property.
- [ ] Path-independent results after rename/move.
- [ ] Later-record creation after moving the host note.
- [ ] Native Base New, copied/imported/synchronized member notes and user moves stay at their chosen locations even while the host Base is active. The explicit plugin creation command uses the current host inbox and avoids filename collisions.
- [ ] Restore refuses changed or duplicated targets after manifest reads, preserves unrelated edits, and restores only the original snapshot.
- [ ] Previewed per-file legacy-property migration with toggle-synchronized counts, default-off membership-scoped `structural_record_id` cleanup, stale and concurrent-change refusal, and rollback that preserves unrelated concurrent edits.
- [ ] Restoration that keeps records.
- [ ] Missing-manifest refusal.
- [ ] Nonempty visible cell values and correct display names after promotion; native sort/edit/save/reopen and multiple views retain ownership without comments.
- [ ] Unmarked recovery requires a unique mandatory membership and exact original manifest proof; conflicting, duplicated, moved or unrelated sources cause no writes.

### Third-party interoperability

- [ ] With a merged Structural Table's raw source selected, open and close an external modal/control. Source remains visible and the exact caret or range is retained; subsequent typing and source commands act at that position.
- [ ] Return focus to the native source editor: the same logical selection restores raw Markdown without scrolling to an unrelated location or changing the note.
- [ ] Click, keyboard-navigate, and edit rendered cells: the logical CodeMirror cursor tracks the mapped source cell while the semantic table stays mounted. Cell textarea IME, Enter, Escape, Shift+Enter and Tab remain Structural Tables-owned and are not handed to external editor keymaps.
- [ ] Choose **Edit table source** from a rendered cell: CodeMirror receives native focus at that cell's Markdown source position and presentation yields immediately.
- [ ] Run source-oriented table tooling (including Advanced Tables where installed) only after source handoff. Safe formatting/content edits that leave valid structural syntax must reparse and return to semantic presentation unchanged in meaning.
- [ ] Verify that Structural Tables does not spoof third-party editor mode or call private plugin APIs. In particular, Advanced Tables' own Live Preview Tab/Enter policy remains external to Structural Tables; source handoff guarantees authoritative Markdown access, not forced takeover of third-party keybindings.
- [ ] Exercise third-party row/column movement and sorting against merged, multi-row-header, row-header and headerless fixtures. Any result that breaks merge/header topology must remain raw Markdown with diagnostics; Structural Tables must not guess a repair or perform a follow-up structural write.
- [ ] Export a saved note and a selected complete table through Export Image's independent Markdown renderer, then inspect the saved image. Check cell text, rowspan/colspan, Callouts, multi-row headers and row headers. Escaped literals, ambiguous source matches and invalid topology must not be guessed into merges. Export completion must include asynchronous cell content, not just empty table geometry.
- [ ] Recheck FakeLink with Hover Editor, with ordinary-table takeover both disabled and enabled. Open, pin, close and reopen hover editors containing ordinary, merged and Callout tables. Virtual-link DOM changes and temporary detachment must not loop, repeatedly mount widgets or change Markdown. Repeat source handoff and external-focus return with a draft present.
- [ ] Cold-start a native separate window in Reading view with the same plugins and theme. Record whether prose and tables appear before any focus switch. If blank, separately check activation of the main window followed by return to the separate window; report initial rendering and recovery as distinct outcomes, and compare the previous version under the same conditions.
- [ ] Compare the previous version and candidate under the same plugin versions, note fixtures and Minimal theme. Verify native ordinary-table ownership, Callout editing/undo, widths and reading headers separately from third-party export results.
- [ ] Reading view output and lifecycle remain unchanged by the Live Preview ownership work.

### Ownership, geometry and interactions

- [ ] Source mode preservation.
- [ ] Every command.
- [ ] Ordinary-table native cell/row/column selections and menus while takeover is disabled.
- [ ] Ordinary-table Live Preview and Reading view ownership, full menus, unchanged source, and immediate native restoration while the opt-in setting is toggled.
- [ ] Theme-following, grid, and three-line styles with logical merged edges.
- [ ] Grid column, row and corner headers share a restrained fill and weight; Three-line row headers have no added fill or vertical divider. Headerless Three-line tables have only top/bottom rules. Explicit alignment and selection remain visible; Follow theme retains theme-owned styling.
- [ ] Span-aware outer borders, native-aligned table origin with handles outside layout, stable comfortable/compact cell dimensions and coarse-pointer touch minimums before and after merges, zebra continuity through row spans, selection clearing when focus/editor cursor leaves or another table receives the pointer, visible focus, one Tab stop per cell/row-handle/column-handle group, LTR/RTL arrow movement, and owned-table handles hidden at rest but revealed for the hovered cell's row and column or retained by keyboard focus/selection without clipping.
- [ ] Drag selection, insert/delete/move/alignment/merge/split/header menus.
- [ ] In an owned/takeover grid, unmodified Delete and Backspace clear only the complete visible owner set for a single cell, partial rectangle, full row, full column, and whole table while preserving table size, roles, alignment, merge markers, and source prefixes. Empty selections are byte-stable no-ops. Active cell textareas retain ordinary text deletion and draft-local history. Right-click Clear selected cells matches keyboard clear; explicit Delete selected rows, Delete selected columns, and Delete table may remove non-empty visible content in one host transaction. Verify merged-owner closure, hidden-overflow refusal versus ragged-GFM success, ordinary-GFM header promotion after explicit header removal, exact parser-range whole-table deletion beside identical tables/prose/Callouts/lists, and Undo/Redo focus restoration without selecting another table. Default-native ordinary GFM must retain Obsidian's own behavior while takeover is off.
- [ ] Bottom/right add controls at content-left, content-center and full width; no page overflow or clipped touch targets. Active drafts and insertion commit/undo together. Header-only tables gain data rows.
- [ ] Terminal Tab appends one data row and opens its first cell; Shift+Tab from the first cell creates nothing. Recheck nested Callout focus and undo.
- [ ] A first handle gesture only selects. A subsequent drag moves selected rows/columns; Shift-click or two handle taps selects a range. Verify exact content, column alignment and prefixes after reorder and undo/redo. Partial merges, split destinations and header crossings show a blocked marker and leave source unchanged; Escape, pointer cancellation, leaving the table and source replacement cancel safely.
- [ ] All four table layouts in narrow and split panes, with theme-following as the fresh default and owned blocks confined to the text column.
- [ ] Optional alternating rows.
- [ ] Refusal without content loss. External table changes, view rebuilding and presentation refresh preserve interrupted drafts in the recovery dialog. Dismiss, reopen by command, copy and explicitly discard drafts; cancelling or successfully committing a cell creates no recovery draft.
- [ ] Paste pipes inside existing code spans and at escape boundaries, preserve fragment whitespace, and verify the committed Wiki-link source.
- [ ] After horizontal scrolling, visible column handles keep a Tab entry; keyboard navigation reveals hidden columns. Edge dragging continues while the pointer rests and stops on cancellation.
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
