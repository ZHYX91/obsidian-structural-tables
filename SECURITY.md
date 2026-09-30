# Security policy

Structural Tables processes tables locally and has no networking or telemetry of its own. It delegates cell rendering to Obsidian, so remote images and embeds in note content remain subject to Obsidian's rendering and network behavior.

Please report security or data-loss issues privately through [GitHub Security Advisories](https://github.com/ZHYX91/obsidian-structural-tables/security/advisories/new). Include the plugin version, Obsidian version, operating system, minimal Markdown sample, exact command, preview state, and whether the file was open in an editor.

Do not include private Vault contents. Reduce examples to synthetic notes whenever possible.

The highest-priority issues are unintended Markdown modification, content loss during merge or split commands, unsafe HTML rendering, incorrect table-range replacement, and source-marker interoperability problems.
