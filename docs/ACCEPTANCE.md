# Acceptance

Automated checks prove source-level behavior and package integrity. They do not prove behavior in a real Obsidian host.

Before a release, test the packaged candidate in an explicitly named disposable Vault on the minimum supported Obsidian version and the current stable version. Cover Reading view; Live Preview double-click and Enter/F2 cell editing; Enter/Escape/Tab, undo/redo, English and Chinese IME; pasted Wiki links and embeds with escaped pipes; Source mode preservation; every command; ordinary-table native cell/row/column selections and menus; rendered structural-table handles, drag selection, insert/delete/move/alignment/merge/split/header menus; all three table layouts in narrow and split panes; refusal without content loss; invalid-table diagnostics; settings persistence; light and dark themes; plugin disable/uninstall cleanup; and conflicts with another table plugin.

Mobile availability remains disabled until equivalent tests pass on a physical device with touch selection and IME composition evidence. Production-Vault deployment is separate and requires explicit authorization for the exact Vault.
