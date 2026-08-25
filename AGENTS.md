# Repository guidance

- Begin audits read-only and preserve unrelated user changes.
- Treat `src/core` as host-independent pure logic; it must not import Obsidian.
- Structural syntax changes require positive, negative, and false-positive fixtures.
- Reading View and Live Preview must never mutate Markdown.
- Editing commands must refuse operations that could discard cell content or create an invalid table.
- A green `npm run check` is not real Obsidian runtime acceptance; use `docs/ACCEPTANCE.md`.
- Use Conventional Commit subjects and normal Git identity; do not add agent attribution.

## Public documentation

`CHANGELOG.md` is the only public document that records release history. README and user help
describe the product as it works now: compatibility, installation, usage, settings, limitations,
privacy, and support. Do not add version banners, dated acceptance evidence, release-status
narratives, or superseded plans outside the changelog. Keep migration or deprecation guidance only
when users still need to act, and state the required action directly. Engineering documents describe
the current contract and repeatable process rather than past executions.

## Deployment and host acceptance

Deploy to a production Vault only when the user explicitly names and authorizes the exact target. Before copying, resolve the target plugin directory, record or back up the currently installed runtime assets, and hash `data.json` when present. Replace only the verified production assets declared by the release contract, preserve `data.json` unless the user explicitly authorizes a reset, and verify the installed hashes after copying.

Acceptance fixtures, cleanup scripts, and destructive test operations may target only explicitly identified temporary Vaults; never point them at an ordinary or production Vault. Source checks, packaged-candidate checks, deployed-host behavior, emulator evidence, and physical-device evidence remain separate claims.
