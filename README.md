# Structural Tables

[简体中文](docs/i18n/README.zh-CN.md)

Structural Tables adds merged cells, multi-row column headers, and row headers to ordinary pipe-table Markdown while keeping the source readable and portable.

<!-- section: features -->
## Features

- Merge left with an exact `<` cell and merge up with an exact `^` cell.
- Use consecutive header rows before the delimiter for multi-row column headers.
- Put one adjacent `||` inside the delimiter row to mark row-header columns.
- Render semantic, accessible tables in Reading view and Live Preview.
- Format, merge, split, set headers, insert, and validate tables with commands and the native editor context menu.
- Diagnose invalid structures without rewriting the note.

<!-- section: requirements-and-compatibility -->
## Requirements and compatibility

The initial release requires Obsidian 1.12.7 or later. Desktop availability is enabled first; mobile availability will follow recorded physical-device acceptance. Structural Tables owns the meaning of exact `<`, `^`, and delimiter `||` tokens inside a structural table, so avoid enabling another table plugin that assigns different meanings to those same tokens.

<!-- section: installation -->
## Installation

Until the plugin is listed in Community plugins, download `main.js`, `manifest.json`, and `styles.css` from a GitHub Release and place them in `.obsidian/plugins/structural-tables/`. Reload Obsidian, then enable Structural Tables under Community plugins.

<!-- section: usage -->
## Usage

```markdown
| Region | Sales | < |
| Quarter | Q1 | Q2 |
| --- || --- | --- |
| North | 10 | 12 |
| ^ | 8 | 11 |
```

All equal-width rows immediately before the delimiter are column-header rows. The `||` divider is internal, appears at most once, does not add a column, and makes columns to its left row headers. A merge must resolve to one top-left content cell, form a complete rectangle, and stay inside one header/data role region. Write `\<` or `\^` for literal marker text.

Once a table uses any structural feature, every row must have exactly the delimiter width. Invalid structures keep their Markdown and show a diagnostic. Use **Format current structural table** for the canonical representation: the top-left cell stores content, the rest of the top row uses `<`, and covered cells below use `^`.

<!-- section: settings -->
## Settings

The settings page follows Obsidian's native controls and has General, Views, and Appearance tabs. Table layout can fit content on the left, fit content in the center, or fit the current note pane. The page also controls Reading view, Live Preview, diagnostics, comfortable/compact density, alternating rows, and Follow Obsidian/English/Simplified Chinese UI language.

<!-- section: limitations -->
## Limitations

Version 0.1 does not add formulas, per-cell styling, block-level or multiline cell content, captions, numbering, or source attributes for repeated headers. Export and conversion to plain GFM are planned but are not part of the first release. The parser deliberately refuses ambiguous or nonrectangular merges.

<!-- section: privacy-and-security -->
## Privacy and security

Structural Tables works locally. It does not make network requests, load remote assets, collect analytics, or send note content anywhere. Rendering never changes source Markdown; command edits are explicit and validated before replacement.

<!-- section: development -->
## Development

Use Node 24.19.0 and npm 11.17.0.

```bash
npm ci
npm run check
```

Repository contracts are documented in the [product requirements](docs/product-requirements.en.md),
[UX specification](docs/ux-spec.en.md), [architecture](docs/architecture.en.md),
[testing strategy](docs/testing-strategy.en.md), and [release guide](docs/release.en.md). See also
the [changelog](CHANGELOG.md), [contribution guide](CONTRIBUTING.md), and
[security policy](SECURITY.md).

<!-- section: support -->
## Support

Report reproducible issues with Obsidian version, editing mode, theme, relevant table Markdown, expected result, and actual result. Remove private note content before sharing a sample.

<!-- section: license -->
## License

[MIT](LICENSE)
