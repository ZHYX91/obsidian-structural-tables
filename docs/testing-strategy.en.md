---
doc_id: testing-strategy
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-10-10
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

DOM emulation is useful for structure and most CSS contracts, but it does not replace real Obsidian geometry, scrolling, theme variables, or touch behavior.

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

Serialization tests also cover display width for ASCII, CJK, combining characters, and emoji. Live Preview DOM tests cover focus, Tab/Shift+Tab, IME composition, handles, selection clearing, and undo/redo.

<!-- section: interchange -->
## Interchange

Cover:

- flattened multi-row header paths and merged values;
- HTML `thead`, `th`, `td`, `rowspan`, `colspan`, `scope`, and line breaks;
- body-only `td` tables remaining headerless instead of inventing a first-row header;
- CSV quoting, TSV cleanup, and plain-GFM compatibility output;
- the unique Sheets Extended separator column and its negative cases;
- Wiki links, literal pipes, and cell line breaks;
- bounded owned-range copy/cut/paste for 1x1, single-column, all-empty and complete merged-owner selections, including exact-topology raw round trips, clipboard failure/stale-session refusal, independently unavailable menu read/write support, and rejection of ordinary text or ordinary HTML without fallback to hidden source;
- portable range HTML carrying spans and escaped raw Markdown text, and plain Markdown using the first copied row as a header without promising equivalent merged layout in external GFM;
- the whole-note HTML-import route leaving mixed prose, multiple tables, images, attachments, links, MathML/SVG, and other unsafe payloads to Obsidian's native paste;
- reparsing at GFM replacement confirmation so stale previews are refused.
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
