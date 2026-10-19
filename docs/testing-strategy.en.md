---
doc_id: testing-strategy
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-10-15
translation_of: testing-strategy.zh-CN.md
---

[简体中文](testing-strategy.zh-CN.md)

# Structural Tables — Testing strategy

<!-- section: levels -->
## Levels

Verification has five layers, and success at one layer does not replace the next:

1. **Pure-core unit tests** for parsing, serialization, table operations, and Base conversion.
2. **DOM tests** for rendering, selection, styling, and clipboard behavior.
3. **Plugin wiring tests** for commands, settings, editor integration, and Reading view.
4. **Package and release checks** for the production bundle, versions, pinned dependencies, and transport.
5. **Real Obsidian acceptance** for host UI, IME, themes, minimum-version behavior, and mobile interaction.

Reading-view regressions use the full note text and reported source-line ranges so one table can never consume another table in the same note.

Separate-window DOM regressions use independent jsdom realms and host helpers that close over their creation document. Check both `ownerDocument` and the constructors of plugin-owned wrappers, tables and cell containers; adoption alone must not satisfy the test. Native Markdown descendants may retain the host's constructors, but surrounding text, cell content and merge structure must remain intact. Cover native sections, Callouts, deferred block mapping, standalone exports and native comparisons.

Locale checks compare every catalog's complete key set and interpolation placeholders with English. Cover all twelve saved language IDs, Obsidian regional/script aliases, unsupported-language fallback, native dropdown names, and RTL interface attributes without changing note direction. Chromium regressions verify RTL row headers on the right, LTR Arabic content retaining column order, physical menu and arrow mapping, native mixed-bidi draft carets, and transpose undo/redo. HTML copies preserve table direction while TSV stays in source order; pending PNG export refuses a direction change.

Critical pointer tests must drive real pointerdown → blur → pointerup → click and inspect the source before release, followed by the remounted target and an immediate keystroke. Include same-table/cross-table/Callout targets, changed and unchanged drafts, rejected/IME sessions, outside-body clicks, double-click/drag/Shift boundaries and stale source identities. DOM emulation is useful for structure and most CSS contracts, but it does not replace real Obsidian geometry, scrolling, theme variables, or touch behavior. Critical writes cover pointerdown → focus changes → confirmation → revalidation of the original file and table → one write → undo/redo. Transient visual selection clearing when a menu or modal takes focus must preserve an unchanged whole-table target; actual target-source, file, editor/view or draft changes must cause zero writes. Real CodeMirror history tests cover the registered command, source menu and native menu, with typing immediately before and after transpose. PR CI also runs a real Chromium owned-menu → pointer modal → CodeMirror write/undo/redo smoke test, plus source/native entry and tall merged-table pointer-focus geometry/scroll checks; these do not replace actual Obsidian or Android acceptance. Multi-window fixtures use independent DOM realms, including existing non-Markdown windows that later open Markdown.

Transpose regressions reparse the complete note and verify exact table boundaries, dimensions, header roles and merge owners, including adjacent pipe text in plain notes, quotes, Callouts and lists. Native menu fixtures use mapped CodeMirror widgets with inherited cell editors and nested panes. Stale callbacks must preserve the exact full source, real document-change transaction count and undo/redo depths, including when a connected editor is adopted into another document.

For two byte-identical native tables in one note, keep the source cursor in the first and transpose the mapped second table through its real menu and confirmation. Assert exact adjoining prose, first-table preservation and one-step full-note undo/redo. Wide-table focus checks use real Chromium touch with actual local overflow in LTR and RTL, both unchanged and changed final-cell drafts. Check single-click detail, collapsed native caret, exact complete source, merged geometry and horizontal/vertical positions. Delayed-rendering tests cancel one-time cell-commit scroll restoration on new input, scrolling, source/history changes, direction, file/editor changes and destruction; a second identical table retains its own position.

Long wrapped-table mouse tests delay actual cell DOM rendering, use a table taller than the viewport, and observe the empty replacement phase. Cover prose and whitespace above/below the table in LTR/RTL, unchanged/changed drafts, genuine double-click word selection and dragging. Verify the initial block estimate and DOM height prevent transient collapse, then clear the temporary minimum height and remeasure a shorter result. A later refresh reuses the rendered table and history never retains the temporary height. Deferred commits accept selection-only changes but reject changed Text/document/file/editor identities with no extra source transaction and retain modified drafts for recovery.

Draft-alignment Chromium cases model Obsidian paragraphs with `dir=auto` and `unicode-bidi: plaintext`. Compare rendered text ranges with actual textarea glyph pixels for English/Arabic across note directions, default/explicit alignment and body/column/row headers. Use native automatic-direction controls for neutral values, mixed/multiline input and Markdown whose hidden link target differs from visible text; preserve exact note bytes. The optional `alignment` argument runs this focused browser matrix. External-control return tests include a fresh mouse/touch gesture, and disconnected-render tests reattach the same DOM without requesting a manual measure before checking natural host/CodeMirror heights.

Arabic display tests keep complete TeX expressions, dimensions, property mappings and paths in their intended visual order. Chromium checks actual character and path-component positions; DOM tests verify that copied drafts, prepared record contents and Markdown retain their original bytes. Registered command and source-menu PNG tests run the rendering pipeline through staging and rasterization, with opposing outer/editor/table directions and asynchronous inner-direction changes.

<!-- section: parser-cases -->
## Parser cases

At minimum, cover:

- ordinary GFM remaining native by default and becoming plugin-owned only when takeover is enabled;
- delimiter cells with one or more hyphens and left/center/right alignment;
- short GFM body rows rendering missing cells as empty, while extra source cells are preserved and protected from lossy writes;
- headerless tables, single-data-row tables, multi-row column headers, and row headers;
- `<` / `^` merges, escaped literal markers, and the `||` row-header divider;
- escaped pipes, code spans, code blocks, frontmatter, comments, raw HTML, and math blocks;
- LF, CRLF, and CR with exact source ranges.

<!-- section: invalid-cases -->
## Invalid cases

Negative tests must prove both the diagnostic and source preservation. Cover:

- missing merge anchors;
- nonrectangular merges;
- merges crossing header/data roles;
- edge, repeated, or spaced `||` dividers;
- Structural Table rows whose width differs from the delimiter;
- header-role changes that would cut through an existing merge;
- structural-looking text inside protected Markdown regions.

<!-- section: commands -->
## Commands and editing

Core operation tests cover:

- cell editing, merge, and split;
- row/column insertion, deletion, movement, and alignment;
- adding or removing column-header and row-header roles;
- content preservation when merged anchors move or are deleted;
- refusal of guarded or implicit operations that would lose unselected or hidden content or cut part of a merge, while explicit selected-content clear/remove actions are tested as authorized destructive intents;
- one-time pipe escaping for Wiki links and embeds;
- Shift+Enter, menu actions, and multiline paste producing representable `<br>` output;
- format round-trips that preserve semantics and LF/CRLF/CR.

Visual arrow geometry tests use real Chromium textarea wrapping/explicit line breaks and caret coordinates to distinguish first/last visual lines from internal lines. Unknown geometry and RTL/mixed bidi keep native behavior. Test key modifier, composition and noncollapsed-selection exclusion, then undo/redo and focus. Serialization tests also cover display width for ASCII, CJK, combining characters, and emoji. Live Preview DOM tests cover focus, Tab/Shift+Tab, IME composition, handles, selection clearing, and undo/redo.

<!-- section: interchange -->
## Interchange

Cover:

- flattened multi-row header paths and merged values;
- HTML `thead`, `th`, `td`, `rowspan`, `colspan`, simple `scope`, and line breaks; complex `id`/`headers` relationships for multi-level and crossing row/column spans, merged data, corner-title exclusion from data, and unique IDs across repeated copies and multiple tables;
- actual whole-table clipboard mode and localized notices for mobile/desktop text fallback, desktop rich writes, and rejected writes through both command and menu entries;
- body-only `td` tables remaining headerless instead of inventing a first-row header;
- CSV quoting, TSV cleanup, and plain-GFM compatibility output;
- the unique Sheets Extended separator column and its negative cases;
- Wiki links, literal pipes, and cell line breaks;
- bounded owned-range copy/cut/paste for 1x1, single-column, all-empty and complete merged-owner selections, including exact-topology raw round trips, clipboard failure/stale-session refusal, independently unavailable menu read/write support, and rejection of ordinary text or ordinary HTML without fallback to hidden source;
- portable range HTML carrying spans and escaped raw Markdown text, and plain Markdown using the first copied row as a header without promising equivalent merged layout in external GFM;
- single-anchor range paste expanding columns/rows, complete merged payload owners, matching multi-cell selection, non-empty overwrite, partial destination merge refusal, cross-role rejection, unchanged owner/raw content outside the rectangle, single-transaction undo/redo, async clipboard identity and Cut-before-success refusal;
- the whole-note HTML-import route leaving mixed prose, multiple tables, images, attachments, links, MathML/SVG, and other unsafe payloads to Obsidian's native paste;
- GFM orientation plans checked with an independent Markdown parser; actual command/native/owned-menu entry points, shared result/source/clipboard bytes, hidden-cell warnings, stale file/view/source identity, active drafts, asynchronous render races, Reading View without a write callback, and a single isolated editor write with Undo/Redo.
- the whole-note HTML-import route using complete plain-text fallback for headings, inherited preserved whitespace and preserved newlines, including zero replacement when safe fallback is absent.

<!-- section: base-promotion -->
## Base conversion

Group pure-core coverage by responsibility:

- **Property names**: numeric, leading-zero, blank, Unicode, reserved, duplicate, emoji, whitespace, dots, quotes, and backslashes.
- **Headerless tables**: generate `column_n` keys and keep the first data row as a record.
- **Structural flattening**: multi-row/merged column headers, row headers, repeated merged row-header values, and merged-data blockers.
- **File names**: Windows reserved device names, duplicate names, and unsafe characters.
- **Ownership and recovery**: current/legacy membership, manifests, strict proof for unmarked Bases, and conflict/ambiguity refusal.
- **Line endings and fences**: LF/CRLF/CR, backtick/tilde fences, and examples nested inside longer fences.

In-memory Vault transactions must also prove zero writes for blocked plans; preservation of concurrent content after record, manifest, or source-replacement failures; restoration without deleting records; new-record placement after the host note moves; and refusal for missing or mismatched manifests.

Legacy-property migration covers preview, default-off retired-ID cleanup, concurrent-change detection, all three line endings, and rollback that touches only plugin-owned changes.

<!-- section: host -->
## Real Obsidian acceptance

Use a clearly named disposable Vault and test at least the minimum supported Obsidian version and the current stable release. Choose scenarios based on the change; rendering, input, or appearance work should include representative light/dark combinations of Default and Minimal.

Check:

- Reading view and Live Preview ownership, Callouts, blockquotes, and list continuations;
- headerless tables, multi-row column headers, row headers, merges, and ordinary-GFM takeover;
- cell editing, IME, Tab, undo/redo, and rejected drafts;
- row/column handles, drag, touch selection, focus, and horizontal scrolling;
- Follow theme, Grid, Three-line, density, and layout variants;
- HTML/GFM/TSV/CSV clipboard behavior and Sheets Extended migration;
- Base preview, confirmation, retained output after failure, moved/renamed records, restore, and legacy migration;
- cleanup when the plugin is disabled or uninstalled.
- FakeLink with Hover Editor under both ordinary-table takeover settings, including detach/reopen and cell edit/history without repeated mounting;
- standalone full-note and selected-table export with HTML lookalikes, inline code, delayed content, superseded sessions and DOM-removing render-child cleanup;
- native whole-table PNG preview/copy/save with the reconstructed five-column meal fixture (not the issue reporter's original source), equal right-side left alignment, local image and actual formula pixels, wide/tall content, theme and source changes, denial/oversize errors, cancellation and unload cleanup; compare saved PNG bytes with the preview and keep this separate from third-party exporter acceptance;
- Advanced Tables operations after source handoff, with exact caret/range preservation and diagnostics for invalid resulting topology;
- native menu coexistence, row/column range preservation, cell reattachment and popout-window closure.
- cold-start Reading view in a separate desktop window, including combinations with FakeLink. Record the initial result before switching focus, then check whether activating the main window and returning restores content; recovery does not turn an initial blank page into an unqualified pass.

Screenshots and DOM tests are supporting evidence, not substitutes for real-host acceptance.


The Chromium gesture checks use actual consecutive mouse clicks and held drags across rendered text and textarea boundaries, plus Scope-before-DOM keyboard dispatch for untouched-cell Undo/Redo. DOM regressions cover active-cell anchored paste, partial-merge refusal, changed/composing drafts, malformed payloads and exact source/history preservation.

<!-- section: mobile -->
## Mobile

When Android regression is selected, record the AVD, Android/API version, Obsidian version, and exact candidate identity. Cover at least:

- startup, Reading view, and Live Preview;
- double-tap editing;
- two-point rectangular selection followed by a separate long press;
- touch-sized row/column handles;
- horizontal table scrolling;
- Chinese and English IME composition;
- source preservation and undo/redo after key edits.

Android physical devices and iOS remain outside the formal acceptance scope unless separately scheduled.
