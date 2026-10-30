# Compatibility notes

This page collects version-specific workarounds and interactions with other Obsidian plugins. For normal usage, see the [Structural Tables README](../README.md).

## Advanced Tables and other source-editing plugins

Structural Tables uses the exact `<`, `^`, and delimiter-row `||` tokens for merges and row headers. Another table plugin may interpret those same characters differently.

For source-based commands such as Advanced Tables, right-click a rendered cell and choose **Edit table source**. Opening a toolbar or dialog keeps the original source selection in place. Advanced Tables controls its own Tab/Enter bindings; switch to Obsidian Source mode when necessary.

After a third-party sort or row/column move, check both the displayed values and merge relationships. Syntactically valid Markdown does not prove that a transformation kept the original meaning. Structural Tables shows diagnostics for invalid structural syntax; it does not silently repair another plugin's changes.

## Conversion to and from HTML

The conversion commands work on complete source-owned tables, not arbitrary HTML fragments. Markdown to HTML retains supported header roles and spans but refuses cells with Markdown links, formatting, formulas or ambiguous syntax. HTML to Markdown accepts text and supported line breaks; unsupported rich cell content is refused and any nonstructural HTML styles or attributes require acknowledgement before replacement. Opening the note in Source mode makes HTML blocks easier to target. The original compact syntax (`<`, `^`, `||`) remains the only structural dialect.

Other Markdown editors may recognize the exported HTML table without interpreting Structural Tables' Markdown extensions. HTML inside a Markdown block does not automatically parse Markdown syntax; review text semantics before conversion.

## FakeLink and separate windows

On Obsidian 1.13.7, some desktop plugin combinations with FakeLink can leave a newly opened separate window blank in Reading view. Switch to the main Obsidian window once, then return. If the note still does not render, use Reading view in the main window or Live Preview.

This is a version-specific workaround, not a general claim about every FakeLink or Obsidian version.

## Third-party image exporters

Markdown-renderer-based exporters can include Structural Tables' merged layout when **Reading view rendering** is enabled. Save the note before exporting and inspect the result. An exported fragment whose source cannot be matched unambiguously is left unchanged rather than guessed.
