# Contributing

## Development setup

Use Node 24.18.0 and npm 11.16.0.

```bash
npm ci
npm run check
```

Keep the pure core independent from Obsidian and browser globals. Rendering must remain source-preserving, and editing commands must validate their result before replacing table Markdown.

## Pull requests

- Explain the user-visible behavior and safety boundary.
- Add tests for every parser, merge, role, or serialization rule.
- Include false-positive tests before broadening table recognition.
- Distinguish automated verification from real Obsidian runtime acceptance.
- Do not add networking, telemetry, or remote assets without an explicit design and privacy review.
- Do not claim mobile support without device evidence.

Use Conventional Commit subjects such as `feat: add ...`, `fix: prevent ...`, or `docs: clarify ...`.
