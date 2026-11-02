# Contributing

## Development setup

Use Node 24.19.0 and npm 11.17.0.

```bash
npm ci
npm run check
```

Keep the pure core independent from Obsidian and browser globals. Rendering must remain source-preserving, and editing commands must validate their result before replacing table Markdown.

The development-only Obsidian API packages pin an affected Moment version. A scoped npm override selects Moment 2.31.0 to address [GHSA-4p3w-j4w9-5jqw](https://github.com/moment/moment/security/advisories/GHSA-4p3w-j4w9-5jqw); it does not replace Obsidian's runtime Moment. Revisit the override when the upstream dependency is patched.

## Pull requests

- Explain the user-visible behavior and safety boundary.
- Add tests for every parser, merge, role, or serialization rule.
- Include false-positive tests before broadening table recognition.
- Distinguish automated verification from real Obsidian runtime acceptance.
- Do not add networking, telemetry, or remote assets without an explicit design and privacy review.
- Do not claim mobile support without device evidence.

Use Conventional Commit subjects such as `feat: add ...`, `fix: prevent ...`, or `docs: clarify ...`.

## Lint dependency maintenance

Caller-scoped overrides keep minimatch at 11.0.4 in the development dependency tree.
`npm ci` runs `scripts/prepare-lint-dependencies.mjs` to adapt the legacy callers to its
named exports and `Minimatch.match` API. The script accepts only reviewed package versions
and exact source fragments; it fails if upstream changes invalidate a patch. Review and
remove the corresponding adaptation when upgrading a caller that supports the new API.
These changes do not enter the plugin runtime bundle.

`npm run lint` first reapplies the adaptations idempotently, then runs
`scripts/check-lint-dependencies.mjs`. The check verifies every locked and resolved minimatch
version and exercises matching and nonmatching cases through the installed callers. Rule
probes use each caller's installed ESLint peer; they do not establish compatibility with a
different ESLint major. The normal lint command independently checks the active repository
configuration without disabling rules. If installation used `--ignore-scripts`, run
`npm run prelint` before invoking ESLint directly.
