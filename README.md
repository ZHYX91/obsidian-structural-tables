# Structural Tables

[English](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/README.md) · [简体中文](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/i18n/README.zh-CN.md)

Structural Tables extends ordinary Markdown pipe tables with merged cells, multiple column-header rows, row headers, and headerless tables. The Markdown stays readable, and simply viewing a table never rewrites the note.

Tables can live in blockquotes, callouts, and list continuations. When you edit or format one, the plugin keeps it in the same place. Move a nested table to the top level only when you want to convert it to an Obsidian Base.

## Screenshots

### Three-line table in Reading view

Group columns under multi-row headers and merge row headers across related records. Three-line styling adds short rules below column groups while keeping the table body uncluttered.

![Three-line table with grouped column headers and merged regional row headers in Reading view](https://raw.githubusercontent.com/ZHYX91/obsidian-structural-tables/main/docs/assets/structural-tables-reading-view-en.png)

### Live Preview

Edit cells directly in Live Preview while keeping merged headers visible. The same table is shown here with the optional grid style; click a cell on desktop, or double-tap it on touch screens, to edit it in place.

![Editing a revenue cell in a grid table with merged headers in Live Preview](https://raw.githubusercontent.com/ZHYX91/obsidian-structural-tables/main/docs/assets/structural-tables-live-preview-en.png)

### Appearance settings

Choose Follow theme, Grid, or Three-line table independently of table layout and density. General, Views, and Appearance keep the settings organized in three tabs.

![Appearance settings showing three-line table style, layout, density, and alternating rows](https://raw.githubusercontent.com/ZHYX91/obsidian-structural-tables/main/docs/assets/structural-tables-settings-en.png)

<!-- section: features -->
## Features

- Merge cells with exact `<` and `^` marker cells.
- Use multiple rows for column headers, mark left-side row-header columns with `||`, or create a table with no column header at all.
- Render the same table structure in Reading view and Live Preview.
- Edit cells directly in Live Preview, add or reorder rows and columns, change alignment, merge or split selections, and change header roles without deleting their text.
- Paste supported HTML tables from browsers, Excel, and Google Sheets while keeping row and column spans.
- Copy tables as HTML, plain GFM, TSV, or CSV.
- Optionally use the Structural Tables editor for ordinary GFM tables. Turning the option off restores Obsidian's native table UI without changing Markdown.
- Convert a table to an Obsidian Base after reviewing the generated records and Property mapping. Moving or renaming those record notes does not break their Base membership.
- Refuse edits that would lose non-empty or hidden source content, and show diagnostics for invalid structural syntax instead of silently rewriting it.

<!-- section: requirements-and-compatibility -->
## Requirements and compatibility

Structural Tables requires Obsidian 1.12.7 or later and supports desktop Obsidian and Android. Converting a table to a Base also requires Obsidian's Bases core plugin.

Inside a Structural Table, exact `<`, `^`, and delimiter `||` tokens have special meanings. If another enabled table plugin is known to use the same syntax, Structural Tables shows a one-time conflict warning.

<!-- section: installation -->
## Installation

Install Structural Tables from Obsidian's Community plugins directory: open **Settings → Community plugins → Browse**, search for **Structural Tables**, select **Install**, and then enable the plugin.

For manual installation, download `structural-tables-<version>.zip` from the [latest release](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest) and extract it into `Vault/.obsidian/plugins/`. The archive contains the `structural-tables/` directory with `main.js`, `manifest.json`, and `styles.css`. Reload Obsidian, then enable Structural Tables under Community plugins.

<!-- section: usage -->
## Usage

1. Create or paste a normal Markdown pipe table.
2. Put `<` in a cell to merge it with the cell on its left, or `^` to merge it with the cell above.
3. Put one adjacent `||` in the delimiter row to mark the columns on its left as row headers.
4. Move the source cursor outside the table in Live Preview, or switch to Reading view, to see the rendered result.
5. In Live Preview, click a cell on desktop or double-tap it on touch screens to edit it. Enter saves, Escape cancels, Shift+Enter inserts a visual line break, and Tab moves to the next visible cell.
6. Use the **+** controls and row/column handles to add, select, move, align, merge, split, delete, or change header roles. Operations that would lose content or split a merged region are refused.
7. Use the command palette or table context menu for formatting, copying, HTML-table import, Sheets Extended migration, and Base conversion.

Reading view is display-only. In-place editing and table controls are available in Live Preview.

### Table syntax

A structural table can combine multiple column-header rows and row headers:

```markdown
| Region  | Sales | <   |
| Quarter | Q1    | Q2  |
| ---     || ---  | --- |
| North   | 10    | 12  |
| ^       | 8     | 11  |
```

Rows immediately above the delimiter are column headers. The `||` divider does not add a column; it marks the columns on its left as row headers.

A delimiter can also come first, which creates a table with no column header:

```markdown
| --- | --- |
| Alice | 10 |
| Bob   | 20 |
```

Select the complete column-header area and choose **Remove column headers** to keep the text but turn those rows into data. You can later select rows at the top and make them column headers again.

Merge markers must form one rectangle and cannot cross a header/data boundary. To show literal `<` or `^` text in a cell, write `\<` or `\^`.

### Editing, line breaks, and math

Shift+Enter, the cell-editor menu, and multiline paste can insert a visual line break. Ordinary text is saved with canonical `<br>`; hand-written `<br>`, `<br/>`, and `<br />` spellings are preserved when the table is only formatted.

Single-line TeX is kept as written when it can be stored safely. A bare pipe inside math, such as `$|x|$` or `$P(A|B)$`, is ambiguous in a Markdown table, so the plugin refuses to save it automatically and keeps the draft open. For those two simple patterns, the cell menu can apply an explicit `\lvert … \rvert` or `\mid` rewrite. More complex expressions must be corrected manually.

### Ordinary GFM tables

Ordinary Markdown tables continue to use Obsidian's native editor by default. Enable **Take over ordinary Markdown tables** if you want the same Live Preview controls on them; disable it to return immediately to Obsidian's native UI.

GFM allows body rows to contain fewer or more source cells than the header. Missing cells display as empty. If a row contains extra source cells that Obsidian does not render, Structural Tables leaves the table readable but makes plugin write operations read-only so those hidden cells cannot be lost.

### Pasting and copying

With **Preserve pasted HTML table spans** enabled, a supported multi-column HTML table can be converted while keeping row and column spans and visual line breaks. HTML that cannot be converted safely is left to Obsidian, or uses the clipboard's complete plain-text form when that fallback is known to be safe.

A body-only HTML table stays headerless instead of having its first row turned into a header. Real `thead`/`th` markup is used when the source provides it.

Use **Copy whole table for Word / HTML** or **Copy current table as HTML** for applications such as Word. You can also copy as plain GFM, TSV, or CSV. Converting a headerless table to plain GFM adds an empty compatibility header because GFM itself requires a header row.

### Convert to Base

Save the note and move a nested table to the top level before converting it to a Base. The preview shows the target folder, generated record notes, Property names, and any table structure that will be flattened.

New records are created under `<note-folder>/_structural-table-records/<table-id>/` by default. That folder is only the initial creation location: moving or renaming a record note does not remove it from the Base. The `structural-tables` list Property keeps the association.

If conversion fails after creating files, the plugin leaves those files in place and reports their folder so you can inspect them. **Restore table from current promoted Base** restores the original table snapshot from `_promotion.json` but deliberately keeps the generated notes.

Blank headers become `column_n`; non-empty headers, including numeric and leading-zero names, are kept as Property names when possible. Duplicate or reserved names receive a numeric suffix.

### Recovering an interrupted edit

A rejected cell edit stays open whenever possible. If an external change or view rebuild interrupts an unsaved draft, Structural Tables keeps a session-only recovery copy. Use **Recover interrupted cell drafts** to reopen the recovery dialog. Recovery copies disappear when Obsidian or the plugin restarts, so copy anything important before then.

<!-- section: settings -->
## Settings

The settings page has **General**, **Views**, and **Appearance** tabs.

- **General**: language, HTML-table paste conversion, and conflict warnings.
- **Views**: Reading view, Live Preview, diagnostics, and the default-off **Take over ordinary Markdown tables** option.
- **Appearance**: Follow theme, Grid, or Three-line table; table width/alignment; comfortable or compact spacing; optional alternating rows.

**Follow theme** leaves header colors and typography to the active Obsidian theme. **Grid** gives semantic headers a consistent header band. **Three-line table** uses top and bottom rules plus one rule below the complete column-header area, with no vertical body rules. A headerless Three-line table naturally has only the top and bottom rules.

Appearance settings affect only rendering; they never change Markdown.

<!-- section: limitations -->
## Limitations

Structural Tables is not a spreadsheet engine and does not calculate formulas. It does not support per-cell styling, captions, numbering, block-level Markdown inside cells, or true multiline Markdown cells.

Imported HTML cells are converted to plain text plus supported visual `<br>` breaks; rich HTML is not converted into Markdown formatting. Converting to a Base flattens table layout into Properties: multi-row column-header paths are joined with ` / `, row headers become normal Properties, and merged row-header values repeat for the records they cover. A merged data cell must be split before Base conversion.

Restoring a converted table requires the generated `_promotion.json` file to remain at the path recorded in the Base block.

<!-- section: privacy-and-security -->
## Privacy and security

Structural Tables processes tables locally and does not add networking or analytics. Cell contents are rendered by Obsidian, so remote images or embeds still follow Obsidian's own network behavior.

Simply rendering a table never changes its Markdown. Edits and menu commands are explicit and validated before replacement. Base conversion creates only the local files shown in its preview. If a conversion fails partway through, created files are kept for inspection rather than deleted automatically.

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
- [Changelog](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CHANGELOG.md)
- [Contributing guide](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/SECURITY.md)

<!-- section: support -->
## Support

- [Q&A](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/q-a): Usage and configuration questions.
- [Ideas](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/ideas): Early feature and workflow ideas.
- [Show and tell](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/show-and-tell): Tips, workflows, and reference implementations.
- Use [GitHub Issues](https://github.com/ZHYX91/obsidian-structural-tables/issues/new/choose) for reproducible bugs and concrete feature requests. Include the Obsidian version, editing mode, theme, relevant table Markdown, expected result, and actual result.
- Report vulnerabilities only through GitHub's [private vulnerability reporting](https://github.com/ZHYX91/obsidian-structural-tables/security/advisories/new); see the [security policy](https://github.com/ZHYX91/obsidian-structural-tables/security/policy) for details.

Never post real private Vault paths, note content, credentials, or personal information publicly.

<!-- section: license -->
## License

[MIT](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/LICENSE) © ZhengYX
