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
- Export a complete table as a PNG with a preview, image copy, and Vault attachment saving on desktop.
- Optionally use the Structural Tables editor for ordinary GFM tables. Turning the option off restores Obsidian's native table UI without changing Markdown.
- Convert a table to an Obsidian Base after reviewing the generated records and Property mapping. Moving or renaming those record notes does not break their Base membership.
- Refuse unintended writes that would discard unselected or hidden source content, while allowing explicit clear/delete actions on the visible selection. Invalid structural syntax stays visible with diagnostics instead of being silently rewritten.

<!-- section: requirements-and-compatibility -->
## Requirements and compatibility

Structural Tables requires Obsidian 1.12.7 or later and supports desktop Obsidian and Android. Converting a table to a Base also requires Obsidian's Bases core plugin.

Inside a Structural Table, exact `<`, `^`, and delimiter `||` tokens have special meanings. If another enabled table plugin is known to use the same syntax, Structural Tables shows a one-time conflict warning.

Image exporters that use Obsidian's Markdown renderer can render merged tables with **Reading view rendering** enabled. Save the note before exporting and check the preview. If an exported fragment cannot be matched uniquely to the saved source, the plugin leaves it unchanged rather than guessing a merge.

On Obsidian 1.13.7, some desktop combinations with FakeLink can leave a newly opened separate window blank in Reading view. Switch to Obsidian's main window once, then return to the separate window; this can let the note finish rendering. If it remains blank, use the main window or Live Preview.

To use source-based commands from plugins such as Advanced Tables, right-click a cell and choose **Edit table source**. Opening a toolbar or dialog keeps your source selection in place. Advanced Tables controls its own Tab/Enter behavior; use Obsidian's Source mode when those bindings require it. After third-party sorting or row/column moves, check the cell values and merge relationships: valid syntax alone does not guarantee that their meaning was preserved. Invalid structural syntax remains visible with diagnostics; Structural Tables does not silently repair or undo another plugin's changes.

<!-- section: installation -->
## Installation

Install Structural Tables from Obsidian's Community plugins directory: open **Settings → Community plugins → Browse**, search for **Structural Tables**, select **Install**, and then enable the plugin.

For manual installation, download `structural-tables-<version>.zip` from the [latest release](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest) and extract it into `Vault/.obsidian/plugins/`. The archive contains the `structural-tables/` directory with `main.js`, `manifest.json`, and `styles.css`. Reload Obsidian, then enable Structural Tables under Community plugins.

<!-- section: usage -->
## Usage

**Quick start:** Create a Markdown table, enter `<` in a cell to merge left or `^` to merge up, then move the source cursor outside the table in Live Preview or switch to Reading view. Click a rendered cell in Live Preview to edit it.

1. Create or paste a normal Markdown pipe table.
2. Put `<` in a cell to merge it with the cell on its left, or `^` to merge it with the cell above.
3. Put one adjacent `||` in the delimiter row to mark the columns on its left as row headers.
4. Move the source cursor outside the table in Live Preview, or switch to Reading view, to see the rendered result. To edit raw Markdown again, right-click a rendered cell and choose **Edit table source**.
5. Click a cell in Live Preview to edit its text. Enter saves and advances; Escape cancels. See **Advanced editing and safe deletion** below for other shortcuts and undo behavior.
6. Use the **+** controls, row/column handles, and the context menu to add, move, merge, split, or remove cells and rows. Delete/Backspace clears selected cell text rather than deleting table structure.
7. Paste a supported HTML table directly into the Markdown editor to import it. Use the command palette for formatting, copying, and Sheets Extended migration. Convert a table to Base from either the command palette or the table context menu.

Reading view is display-only. In-place editing and table controls are available in Live Preview.

### Advanced editing and safe deletion

When text can be mapped to its source precisely, clicking places the caret at that position. For formatted or ambiguous text, the cell opens with its draft selected. Enter saves and moves to the same column in the next logical row (adding a row at the bottom); Shift+Enter inserts a visual line break; Tab moves to the next visible cell. Cmd/Ctrl+B and Cmd/Ctrl+I toggle Markdown bold and italic in the active cell draft. Typing, composition, paste, line breaks, and these shortcuts share undo/redo within the draft; they do not alter the note until the edit is saved. To use other formatting commands, choose **Edit table source**.

Shift+Arrow extends or shrinks a logical grid selection. With that selection focused, Delete/Backspace clears cell contents without removing rows, columns, header roles, or merges. For structural removal, right-click and choose **Delete selected rows**, **Delete selected columns**, or **Delete table**. Clearing or explicitly deleting is undoable in one step; non-empty rows do not need to be cleared first.

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

GFM allows body rows to contain fewer or more source cells than the header. Missing cells display as empty and can still be cleared normally. If a row contains extra source cells that Obsidian does not render, Structural Tables leaves the table readable but makes plugin clear/delete and other write operations read-only; edit or move those extra cells in Markdown first so they cannot be lost. When ordinary-table takeover is off, Delete/Backspace and table deletion remain entirely Obsidian-native.

### Pasting and copying

When pasting into the note's Markdown editor with **Preserve pasted HTML table spans** enabled, a supported multi-column HTML table can be converted while keeping row and column spans and visual line breaks. HTML that cannot be converted safely is left to Obsidian, or uses the clipboard's complete plain-text form when that fallback is known to be safe.

For text with preserved spaces, tabs, line breaks or heading boundaries, the plugin uses the complete plain-text alternative. This keeps the text but may lose table layout or rich formatting. If no safe alternative is available, the paste is blocked and your current selection is kept.

A body-only HTML table stays headerless instead of having its first row turned into a header. Real `thead`/`th` markup is used when the source provides it.

With a grid range selected, Copy/Cut/Paste exchanges Structural Tables' own range data. Paste accepts only that data and requires the same number of rows and columns and the same arrangement of merged cells; it never repeats values across a larger range, adds rows or columns, or changes merges. Single cells, single columns, empty ranges, and complete merged cells are supported. Copy never changes the note; Cut clears only after the clipboard write succeeds and the source and selection are checked again.

Range menu Copy/Cut needs platform clipboard-write support; menu Paste separately needs clipboard-read support. One may be available while the other is not. Plain text, ordinary HTML, or unrecognized range data cannot be pasted directly into a grid selection and never reaches the hidden Markdown source. To paste ordinary text, open a single cell for editing; to import an HTML table, paste in the note's Markdown editor. **Edit table source** also lets you work directly in Markdown.

On mobile, range Copy/Cut writes a plain Markdown table and checks that the system clipboard contains that exact text before Cut can clear anything. The plugin remembers the copied merge layout for the current session. Range Paste works while the clipboard still matches that copy; restarting Obsidian or the plugin loses this session information. Text copied elsewhere belongs in a cell editor or the note editor.

For other applications, range Copy also provides HTML and plain Markdown. Range HTML represents spans and shows the cell's Markdown as raw text. Plain Markdown uses the first copied row as a header and retains structural markers where representable; it does not guarantee the same merge layout in other applications, including vertical merges.

Use **Copy whole table for Word / HTML** or **Copy current table as HTML** for applications such as Word. You can also copy as plain GFM, TSV, or CSV. Converting a headerless table to plain GFM adds an empty compatibility header because GFM itself requires a header row.

On mobile, the HTML copy commands copy tab-separated text. Cell-internal line breaks and tabs become spaces. Rich HTML formatting and merged-cell layout are unavailable through the mobile clipboard.

### Export a table image

On desktop, right-click a table and choose **Export whole table as image…**, or place the source cursor inside a table and run **Export whole table as image** from the command palette. The preview shows the final PNG. **Copy image** and **Save PNG to Vault** use the same bytes; image copy requires clipboard permission, and saving creates a new attachment at the Vault's configured location without overwriting files or inserting a note link. Ordinary GFM tables can also be exported from their native menu or the command palette.

The snapshot uses the current theme, background, table appearance and density. It includes the complete table, merged headers, rendered text, supported math and loaded local image attachments, without editing controls or selection marks. Long content expands the image instead of being cropped. Save or cancel any active cell draft first; the export excludes that draft and never changes Markdown. A source or theme change during generation requires a fresh export; a completed preview retains its original snapshot.

Images use a fixed 2× scale and stop at 8192 pixels per side or 16 megapixels. Oversized tables, unavailable resources needed to preserve the rendered appearance and unsupported interactive or note embeds report failure instead of producing a partial PNG. A font that already falls back in the note keeps that visible fallback; unused font URLs are not required. Cross-origin images may be blocked by browser security; use local attachments. Export is local and has no upload service. Mobile image export is unavailable; use the text copy commands there.

### Convert to Base

Save the note and move a nested table to the top level before converting it to a Base. The preview shows the target folder, generated record notes, Property names, and any table structure that will be flattened.

New records are created under `<note-folder>/_structural-table-records/<table-id>/` by default. That folder is only the initial creation location: moving or renaming a record note does not remove it from the Base. The `structural-tables` list Property keeps the association.

If conversion fails after creating files, the plugin leaves those files in place and reports their folder so you can inspect them. **Restore table from current Base** restores the original table snapshot from `_promotion.json` but deliberately keeps the generated notes.

Blank headers become `column_n`; non-empty headers, including numeric and leading-zero names, are kept as Property names when possible. Duplicate or reserved names receive a numeric suffix.

### Recovering an interrupted edit

A rejected cell edit stays open whenever possible. If an external change or view rebuild interrupts an unsaved draft, Structural Tables keeps a session-only recovery copy. Use **Recover interrupted cell drafts** to reopen the recovery dialog. Recovery copies disappear when Obsidian or the plugin restarts, so copy anything important before then.

<!-- section: settings -->
## Settings

The settings page has **General**, **Views**, and **Appearance** tabs.

- **General**: language, HTML-table paste conversion, and conflict warnings.
- **Views**: Reading view, Live Preview, diagnostics, and the default-off **Take over ordinary Markdown tables** option.
- **Appearance**: Follow theme, Grid, or Three-line table; table width/alignment; comfortable or compact spacing; optional alternating rows.

**Follow theme** leaves borders, header colors, and typography to the active Obsidian theme, including the outer edges of tables without column headers. **Grid** gives semantic headers a consistent header band, with slightly thicker single lines below the complete column-header area and along the row-header divider declared by `||`. Both boundaries remain visible even before data rows are added. These lines follow merged-cell edges; tables without headers keep a uniform grid. **Three-line table** uses top and bottom rules plus one rule below the complete column-header area, with no vertical body rules. A headerless Three-line table naturally has only the top and bottom rules.

Appearance settings affect only rendering; they never change Markdown.

**Export to Word:** Structural Tables uses extra Markdown syntax for merged cells and header structure. For compatible DOCX conversion, [DocWen Assistant](https://github.com/ZHYX91/obsidian-docwen-assistant) can work with the separate local DocWen application. Enable the Structural Tables **input** extension in DocWen's Markdown syntax settings (and the output extension when converting back to Markdown). Conversion is optional and available only on supported desktop systems.

<!-- section: limitations -->
## Limitations

Structural Tables is not a spreadsheet engine and does not calculate formulas. It does not support per-cell styling, captions, numbering, block-level Markdown inside cells, or true multiline Markdown cells.

Imported HTML cells are converted to plain text plus supported visual `<br>` breaks; rich HTML is not converted into Markdown formatting. Converting to a Base flattens table layout into Properties: multi-row column-header paths are joined with ` / `, row headers become normal Properties, and merged row-header values repeat for the records they cover. A merged data cell must be split before Base conversion.

Restoring a converted table requires the generated `_promotion.json` file to remain at the path recorded in the Base block.

<!-- section: privacy-and-security -->
## Privacy and security

Structural Tables processes tables locally and does not upload content or collect analytics. Cell contents are rendered by Obsidian, so remote images or embeds still follow Obsidian's own network behavior. Image export may read the active theme's font or decoration resources to embed them in the local PNG; offline export needs those resources available locally.

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
