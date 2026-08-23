# Acceptance

Automated checks prove source-level behavior and package integrity. They do not prove behavior in a real Obsidian host.

Before a release, test the packaged candidate in an explicitly named disposable Vault on the minimum supported Obsidian version and the current stable version. Cover Reading view, Live Preview reveal-on-cursor behavior, Source mode preservation, every command, native table cell/row/column selections, editor context-menu merge/split/header actions, all three table layouts in narrow and split panes, refusal without content loss, invalid-table diagnostics, settings persistence, light and dark themes, plugin disable/uninstall cleanup, and conflicts with another table plugin.

Mobile availability remains disabled until equivalent tests pass on a physical device with touch selection and IME composition evidence. Production-Vault deployment is separate and requires explicit authorization for the exact Vault.
