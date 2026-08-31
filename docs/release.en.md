---
doc_id: release
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-31
translation_of: release.zh-CN.md
---

[简体中文](release.zh-CN.md)

# Structural Tables — Release procedure

<!-- section: versioning -->
## Versioning

`package.json`, the lockfile, `manifest.json`, `versions.json`, and the tag version must agree. Tags use unprefixed `x.y.z`.

<!-- section: gates -->
## Gates

The ordinary `check` runs runtime, formatting, bilingual sync, lint, type, coverage, production
build, product bundle checks, and common vendored-core validation. `release:check` adds
tag-aware validation. A missing same-version tag is allowed while preparing a candidate, but an
existing tag must point to `HEAD`.

<!-- section: assets -->
## Assets

The public Release contains only `main.js`, `manifest.json`, `styles.css`, and
`structural-tables-x.y.z.zip`. The archive uses a `structural-tables/` root. The workflow handoff
additionally contains `candidate.json` and `SHA256SUMS`; neither is a public Release asset.

<!-- section: workflow -->
## Workflow

Build one deterministic core candidate, complete isolated acceptance, and keep the workspace
candidate envelope, closure, and explicit authorization as separate evidence. Creating and
pushing the exact numeric tag is separately authorized and never triggers publication.

The manual workflow defaults to read-only `verify`. The workspace dispatches `publish` only
with the exact candidate commit and candidate/envelope/closure/authorization digests plus the
original closure and authorization bytes. The verify job reproduces and uploads one fixed
handoff. The write-enabled job validates both transported evidence documents and the core
publication boundary, then performs a read-only GitHub preflight before any write. A missing
Release permits staging, attestation, and creation; an exact existing Release whose bytes and
provenance pass every check is a zero-write safe rerun; any conflict fails before those writes.
`publish-github` repeats the check. A separate post-verification job checks hosted bytes,
metadata, tag identity, and provenance.

An existing same-tag Release is accepted as a successful no-op only when every exact check passes.
Any difference fails; the workflow never overwrites, edits, or appends same-tag assets.

<!-- section: acceptance -->
## Acceptance

Source gates, packaged candidates, disposable Vaults, production Vaults, and Android emulators are separate claims. Android physical devices and iOS are out of scope. Evidence is required before broadening any supported claim.

<!-- section: rollback -->
## Rollback

Published versions are never overwritten. Ship a new patch for defects. Production-Vault actions preserve `data.json` and require explicit authorization for the exact target.
