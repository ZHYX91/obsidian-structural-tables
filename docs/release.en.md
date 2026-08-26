---
doc_id: release
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-26
translation_of: release.zh-CN.md
---

[简体中文](release.zh-CN.md)

# Structural Tables — Release procedure

<!-- section: versioning -->
## Versioning

`package.json`, the lockfile, `manifest.json`, `versions.json`, and the tag version must agree. Tags use unprefixed `x.y.z`.

<!-- section: gates -->
## Gates

Before release, run runtime, formatting, bilingual sync, lint, type, coverage, production build, and asset checks. `release:check` also requires clean committed source and a matching tag.

<!-- section: assets -->
## Assets

The public Release contains only `main.js`, `manifest.json`, `styles.css`, and
`structural-tables-x.y.z.zip`. The archive uses a `structural-tables/` root. The workflow handoff
additionally contains `SHA256SUMS`, but it is not a public Release asset.

<!-- section: workflow -->
## Workflow

Before tagging, manually run the read-only preflight from the current remote default-branch HEAD
with the proposed version. It requires the remote tag and same-version Release to be absent, runs
the full gate, and builds the manual-install ZIP without publishing. After a numeric tag push, the
verify job builds once and uploads an exact digest-bound handoff. The publish job verifies server
identity, bytes, checksums, and attestations before creating an immutable Release.

A failed tag workflow is safely rerunnable. An existing same-tag Release is accepted as a
successful no-op only when it is stable, immutable, contains exactly the four public assets,
matches the current candidate byte for byte, and all four provenance records bind the same tag and
commit. Any difference fails; the workflow never overwrites, edits, or appends same-tag assets.

<!-- section: acceptance -->
## Acceptance

Source gates, packaged candidates, disposable Vaults, production Vaults, emulators, and physical devices are separate claims. Evidence is required before broadening any claim.

<!-- section: rollback -->
## Rollback

Published versions are never overwritten. Ship a new patch for defects. Production-Vault actions preserve `data.json` and require explicit authorization for the exact target.
