# Repository guidance

- Begin audits read-only and preserve unrelated user changes.
- Treat `src/core` as host-independent pure logic; it must not import Obsidian.
- Structural syntax changes require positive, negative, and false-positive fixtures.
- Reading View and Live Preview must never mutate Markdown.
- Editing commands must refuse operations that could discard cell content or create an invalid table.
- A green `npm run check` is not real Obsidian runtime acceptance; use `docs/ACCEPTANCE.md`.
- Use Conventional Commit subjects and normal Git identity; do not add agent attribution.

## Settings surface policy

Declarative settings are intentionally disabled because non-empty definitions would bypass
Structural Tables' three-tab `PluginSettingTab.display()` layout on Obsidian 1.13 and degrade the
user experience. Keep `getSettingDefinitions()` absent or empty. Do not flag the `display()`
deprecation, absent or empty definitions, or missing settings search, and do not propose a
declarative migration unless the user explicitly asks to revisit this decision.

## Manual installation release policy

The versioned `structural-tables-<version>.zip` is an intentional required public release asset for
users who install without the Obsidian Community marketplace. Community ignores it during plugin
ingestion, so the automated-review `extra unsupported files` recommendation is expected and must
not be treated as a defect or a reason to remove the archive. The deterministic ZIP contains one
`structural-tables/` directory with `main.js`, `manifest.json`, and `styles.css`, byte-identical to
the three loose release assets. Release checks must preserve and verify all four public assets.

## Public documentation

`CHANGELOG.md` is the only public document that records release history. README and user help
describe the product as it works now: compatibility, installation, usage, settings, limitations,
privacy, and support. Do not add version banners, dated acceptance evidence, release-status
narratives, or superseded plans outside the changelog. Keep migration or deprecation guidance only
when users still need to act, and state the required action directly. Engineering documents describe
the current contract and repeatable process rather than past executions.

## Deployment and host acceptance

Deploy to a production Vault only when the user explicitly names and authorizes the exact target. Before copying, resolve the target plugin directory, record or back up the currently installed runtime assets, and hash `data.json` when present. Replace only the verified production assets declared by the release contract, preserve `data.json` unless the user explicitly authorizes a reset, and verify the installed hashes after copying.

Acceptance fixtures, cleanup scripts, and destructive test operations may target only explicitly identified temporary Vaults; never point them at an ordinary or production Vault. Source checks, packaged-candidate checks, deployed-host behavior, and Android emulator evidence remain separate claims. Because this plugin is mobile-capable, an exact release candidate requires current desktop and Android emulator passes. Android physical devices and iOS are out of scope.
