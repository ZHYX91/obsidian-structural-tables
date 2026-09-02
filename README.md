# Structural Tables

[English](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/README.md) · [简体中文](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/i18n/README.zh-CN.md)

Structural Tables adds merged cells, multi-row column headers, and row headers to ordinary pipe-table Markdown while keeping the source readable and portable.

## Screenshots

### Reading view

Structural semantics render as a clean, accessible table while the note remains ordinary pipe-table Markdown.

![Structural Tables merged cells, multi-row headers, and row headers in Reading view](https://raw.githubusercontent.com/ZHYX91/obsidian-structural-tables/main/docs/assets/structural-tables-reading-view-en.png)

### Live Preview

Leave the table to see its rendered structure; click a cell on desktop, or double-tap it on touch screens, to edit it in place.

![Structural Tables rendered in Live Preview](https://raw.githubusercontent.com/ZHYX91/obsidian-structural-tables/main/docs/assets/structural-tables-live-preview-en.png)

### Settings

General, Views, and Appearance keep import, rendering, ordinary-table takeover, diagnostics, layout, and styling controls clearly separated.

![Structural Tables settings with ordinary Markdown table takeover](https://raw.githubusercontent.com/ZHYX91/obsidian-structural-tables/main/docs/assets/structural-tables-settings-en.png)

<!-- section: features -->
## Features

- Merge left with an exact `<` cell and merge up with an exact `^` cell.
- Use consecutive header rows before the delimiter for multi-row column headers.
- Put one adjacent `||` inside the delimiter row to mark row-header columns.
- Render semantic, accessible tables in Reading view and Live Preview.
- Edit cells in place, including automatic `|` escaping for pasted Wiki links.
- Select complete rows or columns with handles, then insert, delete, move, align, merge, split, or set headers from the context menu. Desktop reveals the hovered, keyboard-focused, or selected handle; coarse-pointer devices keep touch-sized handles visible.
- Paste HTML tables from browsers and spreadsheets while preserving row and column spans.
- Copy valid tables as semantic HTML, portable GFM, TSV, or CSV, and preview before flattening a table to GFM.
- Convert unambiguous Sheets Extended separator columns into canonical row-header syntax.
- Upgrade a valid ordinary or structural table into an embedded Obsidian Base whose rows are independent Markdown notes, directly from the table context menu or command palette.
- Keep promoted membership in `structural_table_ids`, keep record identity in `structural_record_id`, and allow record notes to move or be renamed without leaving the Base.
- Preview every promotion, create a schema-versioned recovery manifest, roll back failed file creation to trash, restore the original table without deleting generated notes, and organize later records created by either the native Base New action or the plugin command under the host note's current folder.
- Diagnose invalid structures without rewriting the note.

<!-- section: requirements-and-compatibility -->
## Requirements and compatibility

Structural Tables requires Obsidian 1.12.7 or later and supports desktop Obsidian and Android. Upgrade to Base additionally requires Obsidian's Bases core plugin to be enabled. Structural Tables owns the meaning of exact `<`, `^`, and delimiter `||` tokens inside a structural table. By default it warns once when an enabled table plugin is known to assign overlapping meanings to those tokens.

<!-- section: installation -->
## Installation

Install Structural Tables from Obsidian's Community plugins directory: open **Settings → Community plugins → Browse**, search for **Structural Tables**, select **Install**, and then enable the plugin.

For manual installation, download `structural-tables-<version>.zip` from the [latest release](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest) and extract it into `Vault/.obsidian/plugins/`. The archive contains the `structural-tables/` directory with `main.js`, `manifest.json`, and `styles.css`. Reload Obsidian, then enable Structural Tables under Community plugins.

<!-- section: usage -->
## Usage

1. Create or paste an ordinary pipe table in a Markdown note.
2. Use an exact `<` cell to merge left, an exact `^` cell to merge up, or one adjacent `||` inside the delimiter row to mark the columns on its left as row headers.
3. Leave the table in Live Preview, or switch to Reading view, to see the rendered structure.
4. Click a rendered cell on desktop, double-tap it on a touch screen, or select it and press Enter/F2, to edit it in place. Enter commits, Escape cancels, and Tab commits and advances.
5. Use the row/column handles, drag across cells with a mouse, or tap the first and last cell of a rectangle on Android. Then right-click or long-press to insert, safely delete, move, align, merge, split, or set headers.
6. Paste an HTML table from a browser, Excel, or Google Sheets to preserve supported row and column spans.
7. Open the command palette to preview and confirm canonical formatting, copy the current valid table as HTML, GFM, TSV, or CSV, preview a flatten-to-GFM conversion, or migrate a Sheets Extended row-header separator.
8. Right-click a table and choose **Upgrade to Base…**. Structural tables use **Expand structure and upgrade to Base…**, whose preview explains flattened header paths, ordinary row-header properties, repeated merged row-header values, and any blocking merged data cell before files can be created.

```markdown
| Region  | Sales | <   |
| Quarter | Q1    | Q2  |
| ---     || ---  | --- |
| North   | 10    | 12  |
| ^       | 8     | 11  |
```

All equal-width rows immediately before the delimiter are column-header rows. The `||` divider is internal, appears at most once, does not add a column, and makes columns to its left row headers. A merge must resolve to one top-left content cell, form a complete rectangle, and stay inside one header/data role region. Write `\<` or `\^` for literal marker text.

Inside a cell, `<br>`, `<br/>`, and `<br />` all render as a visual line break in Reading view and owned Live Preview tables. Structural Tables preserves the exact spelling you write and does not normalize it. This is not true multiline or block content: formatting preserves the tag, while conversions and exports give it no special line-break meaning.

Once a table uses any structural feature, every row must have exactly the delimiter width. Invalid structures keep their Markdown and show a diagnostic. Use **Format current structural table** for the canonical representation: the top-left cell stores content, the rest of the top row uses `<`, and covered cells below use `^`. GFM, TSV, and CSV conversion repeats merged values and joins multi-row column-header paths with ` / ` so the flattened result remains explicit.

In Live Preview, ordinary Markdown tables remain in Obsidian's native editor by default. Enable **Take over ordinary Markdown tables** to give unchanged GFM tables the same rendered widget, row/column handles, cell selection, in-place editor, context menu, layout, density, and alternating-row appearance as structural tables; disabling it restores native behavior immediately. Rendered tables use theme-aware semantic backgrounds: column and corner headers are stronger than row headers. Handles reveal individually for the hovered, keyboard-focused, or selected row or column instead of appearing as a full grid. Pasting `[[Target|Alias]]` or `![[Image|Size]]` into an owned cell automatically stores the table-safe forms `[[Target\|Alias]]` and `![[Image\|Size]]`; existing escapes are not doubled. Operations that would discard non-empty content or break a merged rectangle are refused.

Promotion creates records under `<host-folder>/_structural-table-records/<table-id>/`. That directory is a creation inbox, not a membership boundary: moving or renaming a record note does not change its `structural_table_ids` membership. Existing records stay where the user placed them when the host note moves. The generated Base's native **New** action registers the just-created note with `structural_record_id` and moves it into the inbox beside the host note; a note that the user has already moved stays at its chosen location. **Create record for current promoted Base** remains available from the command palette and context menu. Use **Restore table from current promoted Base** to recover the original table from `_promotion.json`; generated notes are deliberately kept. The operation stores imported cell values as strings so leading zeroes and identifiers remain unchanged.

<!-- section: settings -->
## Settings

The settings page follows Obsidian's native controls and has General, Views, and Appearance tabs. General controls HTML-table paste conversion and startup conflict warnings. Views includes the default-off ordinary-table takeover alongside Reading view, Live Preview, and diagnostics. New installations fit tables to their content and align them left by default; content-center and pane-width layouts remain available. Appearance also controls comfortable/compact density and alternating rows; language can Follow Obsidian or use English/Simplified Chinese.

<!-- section: limitations -->
## Limitations

Structural Tables does not support formulas, per-cell styling, block-level or true multiline cell content, captions, numbering, source attributes for repeated headers, or automatic rich-text-to-Markdown conversion inside imported HTML cells. Imported cell content is plain text. Base upgrade flattens layout structure into properties: multi-row header paths are joined with ` / `, row headers become ordinary properties, and merged row-header values repeat per record. A merged data cell blocks confirmation and identifies its location until it is split. Native-New adoption is deliberately limited to just-created notes that match exactly one Structural Tables Base; ambiguous notes are left in place. Recovery requires the generated `_promotion.json` to remain at the path recorded in the Base block. The parser deliberately refuses ambiguous or nonrectangular merges.

<!-- section: privacy-and-security -->
## Privacy and security

Structural Tables works locally. It does not make network requests, load remote assets, collect analytics, or send note content anywhere. Rendering never changes source Markdown; in-place and menu edits are explicit and validated before replacement. Promotion creates only the previewed local record notes and recovery manifest. A failed promotion moves its newly created table-specific directory to the configured Obsidian trash.

<!-- section: development -->
## Development

Use Node 24.19.0 and npm 11.17.0.

```bash
npm ci
npm run check
```

Developer references:

- [Product requirements](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/product-requirements.en.md)
- [UX specification](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/ux-spec.en.md)
- [Architecture](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/architecture.en.md)
- [Testing strategy](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/testing-strategy.en.md)
- [Release procedure](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/release.en.md)
- [Changelog](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CHANGELOG.md)
- [Contributing guide](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/SECURITY.md)

<!-- section: support -->
## Support

- Use [General](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/general) for workflow ideas and general feedback.
- Use [Q&A](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/q-a) for usage and configuration questions.
- Use the structured [GitHub issue forms](https://github.com/ZHYX91/obsidian-structural-tables/issues/new/choose) for reproducible bugs and concrete feature requests. Include the Obsidian version, editing mode, theme, relevant table Markdown, expected result, and actual result.
- Report vulnerabilities only through GitHub's [private vulnerability reporting](https://github.com/ZHYX91/obsidian-structural-tables/security/advisories/new); see the [security policy](https://github.com/ZHYX91/obsidian-structural-tables/security/policy) for details.

Never post real private Vault paths, note content, credentials, or personal information publicly.

<!-- section: license -->
## License

[MIT](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/LICENSE) © ZhengYX
