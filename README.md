# Structural Tables

[English](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/README.md) · [简体中文](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/i18n/README.zh-CN.md)

Structural Tables adds merged cells, multi-row column headers, and row headers to ordinary pipe-table Markdown while keeping the source readable and portable.

## Screenshots

### Reading view

Structural semantics render as a clean, accessible table while the note remains ordinary pipe-table Markdown.

![Structural Tables merged cells, multi-row headers, and row headers in Reading view](https://raw.githubusercontent.com/ZHYX91/obsidian-structural-tables/main/docs/assets/structural-tables-reading-view-en.png)

### Live Preview

Leave the table to see its rendered structure; double-click a cell to edit it in place.

![Structural Tables rendered in Live Preview](https://raw.githubusercontent.com/ZHYX91/obsidian-structural-tables/main/docs/assets/structural-tables-live-preview-en.png)

### Settings

Reading view, Live Preview, and diagnostics are separate, clearly described controls.

<!-- section: features -->
## Features

- Merge left with an exact `<` cell and merge up with an exact `^` cell.
- Use consecutive header rows before the delimiter for multi-row column headers.
- Put one adjacent `||` inside the delimiter row to mark row-header columns.
- Render semantic, accessible tables in Reading view and Live Preview.
- Edit cells in place, including automatic `|` escaping for pasted Wiki links.
- Select complete rows or columns with handles, then insert, delete, move, align, merge, split, or set headers from the context menu.
- Diagnose invalid structures without rewriting the note.

<!-- section: requirements-and-compatibility -->
## Requirements and compatibility

Structural Tables requires Obsidian 1.12.7 or later and supports desktop Obsidian only. It owns the meaning of exact `<`, `^`, and delimiter `||` tokens inside a structural table, so avoid enabling another table plugin that assigns different meanings to those same tokens.

<!-- section: installation -->
## Installation

Open **Settings → Community plugins → Browse**, search for **Structural Tables**, install it, and enable it. For a manual installation, download `structural-tables-<version>.zip` from the [latest release](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest) and extract it into `Vault/.obsidian/plugins/`. The archive contains the `structural-tables/` directory with `main.js`, `manifest.json`, and `styles.css`. Reload Obsidian, then enable Structural Tables under Community plugins.

<!-- section: usage -->
## Usage

1. Create or paste an ordinary pipe table in a Markdown note.
2. Use an exact `<` cell to merge left, an exact `^` cell to merge up, or one adjacent `||` inside the delimiter row to mark the columns on its left as row headers.
3. Leave the table in Live Preview, or switch to Reading view, to see the rendered structure.
4. Double-click a rendered cell, or select it and press Enter/F2, to edit it in place. Enter commits, Escape cancels, and Tab commits and advances.
5. Use the row/column handles or drag across cells, then right-click to insert, safely delete, move, align, merge, split, or set headers.
6. Open the command palette for insertion, formatting, validation, and structural editing actions.

```markdown
| Region | Sales | < |
| Quarter | Q1 | Q2 |
| --- || --- | --- |
| North | 10 | 12 |
| ^ | 8 | 11 |
```

All equal-width rows immediately before the delimiter are column-header rows. The `||` divider is internal, appears at most once, does not add a column, and makes columns to its left row headers. A merge must resolve to one top-left content cell, form a complete rectangle, and stay inside one header/data role region. Write `\<` or `\^` for literal marker text.

Once a table uses any structural feature, every row must have exactly the delimiter width. Invalid structures keep their Markdown and show a diagnostic. Use **Format current structural table** for the canonical representation: the top-left cell stores content, the rest of the top row uses `<`, and covered cells below use `^`.

In Live Preview, ordinary Markdown tables remain entirely in Obsidian's native editor. A rendered structural table has its own row/column handles, cell selection, in-place editor, and context menu because Obsidian's native widget cannot represent row spans, column spans, or multi-row headers. Pasting `[[Target|Alias]]` or `![[Image|Size]]` into a structural cell automatically stores the table-safe forms `[[Target\|Alias]]` and `![[Image\|Size]]`; existing escapes are not doubled. Operations that would discard non-empty content or break a merged rectangle are refused.

<!-- section: settings -->
## Settings

The settings page follows Obsidian's native controls and has General, Views, and Appearance tabs. New installations fit tables to the current note pane by default; content-left and content-center layouts remain available. The page also controls Reading view, Live Preview, diagnostics, comfortable/compact density, alternating rows, and Follow Obsidian/English/Simplified Chinese UI language.

<!-- section: limitations -->
## Limitations

Structural Tables does not support formulas, per-cell styling, block-level or multiline cell content, captions, numbering, source attributes for repeated headers, HTML export, or conversion to plain GFM. The parser deliberately refuses ambiguous or nonrectangular merges.

<!-- section: privacy-and-security -->
## Privacy and security

Structural Tables works locally. It does not make network requests, load remote assets, collect analytics, or send note content anywhere. Rendering never changes source Markdown; in-place and menu edits are explicit and validated before replacement.

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
