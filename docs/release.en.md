---
doc_id: release
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-09-06
translation_of: release.zh-CN.md
---

[简体中文](release.zh-CN.md)

# Structural Tables — Release procedure

This document defines the repeatable Structural Tables release process. Source, the Candidate
Bundle, real Obsidian acceptance, GitHub publication, and production-Vault deployment are separate
boundaries.

<!-- section: boundaries -->
## Boundaries

An authorized stable version tag push triggers publication. Manual dispatch on the same tag supports verify-only or publish mode through the same workflow. Host acceptance is optional; publishing does not deploy to a Vault.

<!-- section: version-source -->
## Version and source

`manifest.json`, `package.json`, `package-lock.json`, and `versions.json` bind one version. CI checks out the exact event commit, verifies the tag and default-branch ancestry, installs pinned dependencies, and runs `npm run release:check` once.

<!-- section: candidate-bundle -->
## Candidate Bundle

The vendored release-core and thin adapter create a deterministic Candidate Bundle containing `main.js`, `manifest.json`, `styles.css`, `structural-tables-x.y.z.zip`, `SHA256SUMS`, and `candidate-bundle.json`. The ZIP contains one `structural-tables/` directory with files identical to the loose assets. The Bundle binds source, toolchain, build configuration, workflow, and acceptance fixtures.

<!-- section: product-acceptance -->
## Optional product acceptance

Use `docs/ACCEPTANCE.md` for quick checks, targeted regression, or full regression. Record the exact candidate, host and theme versions, selected scope, and observed results. Missing, skipped, incomplete, or failed host checks do not prevent explicitly authorized publication and are never converted to passed. Android physical devices and iOS are outside the acceptance scope.

<!-- section: standalone-workflow -->
## Standalone workflow

Tag push and manual dispatch use the same build, publish, and post-verification jobs. The read-only build job produces and verifies the Bundle. Publication downloads that fixed artifact without rebuilding and verifies the event, tag, commit, and Bundle digest before writing. Manual verify mode performs no publication.

<!-- section: publication-verification -->
## Publication and verification

Actions generates SLSA build provenance for the four public assets. The publisher verifies their source, tag and workflow, creates a draft, downloads and checks all draft assets, then publishes the immutable Release. A separate job checks the hosted release. Only the three loose files and versioned ZIP are public assets; Bundle metadata stays in the CI artifact. GitHub publication and Community Directory review are separate outcomes.

<!-- section: failure-deployment -->
## Failure and deployment

An exact existing immutable release is a verified no-op. A complete draft bound to the same Bundle can resume publication. Conflicting or incomplete assets fail without overwriting; inspect the failed operation before retrying. Never delete or retag automatically on verification failure. A deleted immutable tag name cannot be reused. Vault deployment requires separate authorization and preserves `data.json`.
