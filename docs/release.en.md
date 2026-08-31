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

This document defines the repeatable Structural Tables release process. Source, the Candidate
Bundle, real Obsidian acceptance, GitHub publication, and production-Vault deployment are separate
boundaries.

<!-- section: boundaries -->
## Boundaries

An ordinary tag push does not trigger publication. Commit, push, tag, workflow dispatch, GitHub
Release, and production-Vault deployment are separately authorized; no local gate makes a remote
write.

<!-- section: version-source -->
## Version and source

`manifest.json`, `package.json`, `package-lock.json`, and `versions.json` bind one canonical version
and exact commit/tree. A clean worktree must pass `npm run release:check`; a same-version tag must be
absent or already point at that commit.

<!-- section: candidate-bundle -->
## Candidate Bundle v3

The vendored release-core `2.0.0` and thin adapter create the sole Candidate Bundle v3 containing
`main.js`, `manifest.json`, `styles.css`, `structural-tables-x.y.z.zip`, `SHA256SUMS`, and
`candidate-bundle.json`. The versioned ZIP uses a `structural-tables/` root. The Bundle also binds
the toolchain, core/config/workflow, product payload, scenario contract, and fixture hashes.

<!-- section: product-acceptance -->
## Product acceptance

The same Bundle requires desktop and Android-emulator acceptance covering Reading View and Live
Preview column spans, row spans, multi-row headers, row-header boundaries, preview-first format,
and invalid-source preservation with a bounded diagnostic. Android physical devices and iOS are
out of scope.

<!-- section: standalone-workflow -->
## Standalone workflow

The generated, checked-in standalone workflow accepts only explicit `workflow_dispatch`. Its
read-only verify job performs one independent install and one complete `release:check` at the exact
commit, rebuilds the Bundle, and source-verifies it. The publish job downloads the fixed artifact
and performs transport verification without restoring `dist`.

<!-- section: publication-verification -->
## Publication and verification

The acceptance closure does not authorize publication; separate authorization binds the same
Bundle and closure. Before the first mutation, the workflow deeply validates the records, tag, and
read-only preflight. The public Release contains exactly the three loose assets and versioned ZIP;
`SHA256SUMS` and `candidate-bundle.json` remain in the private Bundle. Post-verification reads back
hosted bytes and provenance.

<!-- section: failure-deployment -->
## Failure, rollback, and deployment

An existing same-tag Release is a zero-write no-op only when exact; any difference fails without
overwrite and fixes use a new version. Production-Vault deployment requires separate authorization
for the exact Vault and preserves `data.json`; candidate, host, publication, and deployment verdicts
are reported separately.
