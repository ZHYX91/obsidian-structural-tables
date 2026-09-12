---
doc_id: architecture
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-09-05
translation_of: architecture.zh-CN.md
---

[简体中文](architecture.zh-CN.md)

# Structural Tables — Architecture

<!-- section: boundaries -->
## Boundaries

`src/core` is host-independent pure TypeScript. Configuration, rendering, editor, Reading view, and app wiring are layered. The public repository depends on no adjacent repository or local Vault.

<!-- section: parser -->
## Parser

The parser scans GFM delimiter candidates with at least three hyphens, skips BOM-prefixed frontmatter closed by either `---` or `...`, fenced code, and indented code, respects escaped pipes and code spans, and emits source ranges, role grids, merge anchors, and diagnostics.

<!-- section: validation -->
## Validation

Merges resolve only left or up, preventing directional cycles. Validation then checks anchors, role boundaries, and rectangular closure. Strict row width applies after structural mode is active.

<!-- section: rendering -->
## Rendering

One shared DOM renderer serves the Reading view postprocessor and CodeMirror widget. Live Preview stores block decorations in a CodeMirror `StateField`, while a separate view plugin owns composition and view lifecycle. Structural tables always enter this path; ordinary GFM tables enter it only while the opt-in takeover setting is enabled. Refreshing that setting rebuilds editor decorations and Reading views without changing source. Each visible anchor cell carries block-end and inline-end flags derived from its row/column span, so CSS removes internal borders by grid geometry rather than DOM-child position. Row backgrounds sit below transparent data cells so zebra stripes can continue under row spans. The owned widget adds cell selection, row/column handles, a roving tab stop for each control group, and a focused textarea editor without moving the CodeMirror cursor into the replaced range. Mouse pointers own drag selection; touch pointers use a two-tap range state and deliberately preserve the host's initial pointer event for scrolling and long press. Reading view slices Obsidian's full section text to the exact reported source-line range before parsing, then maps either an Obsidian-native table or the exact raw source block emitted for row-header syntax; this prevents a later table from being substituted with an earlier one. Recursive renderer callbacks are ignored. Cell content uses Obsidian MarkdownRenderer, with component lifecycle cleanup.

Live Preview separates immutable CodeMirror widget descriptions from DOM-owned interaction sessions. A source-position or table-index change rebinds an unchanged table to the current snapshot without recreating its textarea or dropping a draft. Parsed tables are cached in editor state until the document changes; selection, settings, and composition changes only rebuild decorations. Cell traversal belongs to the pure core and visits visible anchors in source order in both directions, skipping covered merge slots.


Native Callout blocks use a source-owned mounting session rather than reverse DOM offsets or unchecked table indexes. The editor resolves the source block with CodeMirror's forward position mapping; both views compare native-rendered block signatures, including rich raw paragraphs and multi-block headers. Identical tables use source order only when the complete matching target inventory agrees. Embedded-note targets and ambiguous mappings stay untouched. Editor mounts track changes by source range and exact source, and pending cell focus is fulfilled only when the matching replacement mounts. Host mutations retry pending mappings; diagnostics distinguish missing DOM, rendering, failed rendering, unmatched or ambiguous targets, and mounted tables.

<!-- section: editing -->
## Editing

Commands and in-place edits produce candidate source from a pure in-memory ownership grid and parse it again. Row/column transformations rebuild rectangular merge ownership, migrate surviving anchors, and refuse content loss or invalid boundaries. Cell input escapes unescaped pipes outside code spans before one whole-table CodeMirror transaction. Every explicit source write aligns separator pipes by terminal display width, including CJK and emoji, while preserving row-header dividers, alignment markers, escaped pipes, Wiki links, code spans, and the note's existing LF, CRLF, or CR line ending. Rendering never calls the serializer or writes source.

<!-- section: interchange -->
## Interchange

A pure-core projection expands a valid structural table into stable column paths and two-dimensional data. GFM, TSV, CSV, and later record migrations share that projection; semantic HTML uses the validated rowspan, colspan, roles, scope, and real break elements. Clipboard wiring normalizes an HTML DOM into cells, spans, th/td roles, and canonical `<br>` visual breaks before the pure core generates and reparses structural Markdown. Sheets Extended migration accepts only one non-edge pseudo-separator column whose cells are all exact `-` tokens.

<!-- section: base-promotion -->
## Base promotion

The pure core derives stable unique property keys, record values, filename candidates, list-valued `structural-tables` membership, and embedded Base source from the shared table projection. A new promotion preserves every trimmed non-empty column path as its Property key, reserves `column_n` for wholly blank headers, resolves canonical duplicates and control-key collisions with numeric suffixes, and emits YAML-quoted `note.<key>` property IDs for display configuration. Filters use bracket access in expressions. The metadata reader parses YAML and accepts both property IDs and older expression-shaped orders without rewriting notes. Column-header merges flatten into column paths, and merged row-header values repeat per record; data-region merges must be split first. The app layer allocates a unique table directory and ID per promotion, creates every record plus `_promotion.json`, reparses the unchanged source table, and then performs one editor replacement. Records have no plugin identity property. Any creation or snapshot failure sends that promotion-specific directory through Obsidian's trash policy.

Versioned `structural-tables` YAML configuration stores the table ID and manifest path through native Base saves. Legacy metadata comments remain readable. An unmarked Base is only a recovery candidate when one mandatory membership identifies a unique block; before any write, its original manifest must match the source note, table ID and recorded manifest path. A moved unmarked source cannot be inferred safely and requires explicit metadata repair. Duplicate IDs, conflicting metadata, malformed YAML and unsafe paths are refused. The offline YAML parser is pinned and bundled for browser use.

The recovery manifest records the original table, generated Base, source file, and initial record paths. Restoration replaces only the current plugin Base with the matching ID and never deletes records. Membership does not query paths, so record rename and move need no event listener. The plugin's new-record command computes an inbox from the host note's current folder; moving the host never moves existing records. Runtime reads both `structural-tables` and legacy `structural_table_ids`; equivalent dual values are accepted, while malformed or conflicting values fail closed. The explicit Vault-wide migration previews each affected file and action, keeps optional cleanup counts synchronized with the toggle, rechecks plugin-owned frontmatter and exact Base blocks, updates old membership fields and Base filters across LF, CRLF, and CR endings, and offers off-by-default `structural_record_id` cleanup only for notes with valid membership. Fence-aware discovery ignores examples nested in longer Markdown fences. If a later write fails, rollback reverses only the properties and exact blocks written by the migration, preserving unrelated concurrent edits.

<!-- section: settings -->
## Settings

Persisted settings use a schema-1 envelope. The previous unversioned object is the only legacy input: startup sanitizes it once and queues the schema-1 envelope, while current schema-1 data is normalized without another migration. Any explicit unknown or malformed schema is incompatible and read-only, so this plugin version cannot overwrite future fields. Settings saves pass through one serialized coordinator. Each queued save owns an immutable snapshot, failed saves remain visible and retryable, and unload flushes the queue and retries the latest failed snapshot once.

<!-- section: release -->
## Release

Node, npm, and dependency versions are locked. CI runs the canonical gate. The tag workflow transfers exact build assets, verifies digests, and publishes an immutable Release.
