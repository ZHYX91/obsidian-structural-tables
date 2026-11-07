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

## Shared maintenance tool snapshots

`scripts/shared-tools.lock.json` records the source repository, one full reviewed commit,
and SHA-256 values for `runtime-contract.mjs`, `prepare-lint-dependencies.mjs` and
`check-lint-dependencies.mjs`. Their existing paths are the snapshots; there is no second
copy or runtime dependency on another plugin. The source is
[Property Order](https://github.com/ZHYX91/obsidian-property-order).

`npm run check:tools` compares the checked-in files with this local lock. It runs offline;
it does not query GitHub or authenticate the recorded commit remotely. Runtime checks,
installation hooks, lint preparation and build entry points reject drift before loading
these tools. Runtime checks require the exact Node/npm versions and agreement between
`.node-version`, `engines.node` and `packageManager`. With dependencies installed, builds
need no network connection or sibling repository to obtain maintenance code.

To update a snapshot:

1. Review changes to the three source files in Property Order and select the full commit
   containing those changes. Preserve the reviewed lint adaptations until their upstream
   callers support the newer API.
2. Copy all three files from that exact commit into the same paths in each consuming
   repository. Update the lock's commit and SHA-256 values from those exact bytes together;
   an arbitrary local edit and a new hash are not evidence of reviewed upstream source.
3. For Property Order itself, commit the reviewed source changes first, then update its
   lock to that existing commit in a follow-up commit. This keeps the source identity
   concrete without requiring a commit to name itself.
4. Run `npm run check:tools`, `npm run check:runtime`, `npm run test:tools`, and
   `npm run check`. Review the installed lint-caller probes as part of the normal lint gate.

The source snapshot and dependency lock serve different purposes. Updating these scripts
alone does not authorize changing dependency versions, publishing packages or releasing a plugin.
