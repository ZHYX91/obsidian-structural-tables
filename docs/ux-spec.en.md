---
doc_id: ux-spec
language: en
source_language: zh-CN
translation_status: synced
status: stable
last_synced: 2026-08-22
translation_of: ux-spec.zh-CN.md
---

[简体中文](ux-spec.zh-CN.md)

# UX specification

<!-- section: principles -->
## Principles

Source remains visible and recoverable; rendering interprets but never rewrites; an operation that could lose content is refused.

<!-- section: live-preview -->
## Live Preview

Show the semantic table while every cursor and selection is outside it. Reveal raw Markdown immediately on entry. Do not switch rendering during IME composition.

<!-- section: reading-view -->
## Reading view

Render with `thead`, `tbody`, `th`, `td`, `rowspan`, `colspan`, and suitable `scope` values. Continue to use Obsidian Markdown rendering inside cells.

<!-- section: commands -->
## Commands

Insert template, format, merge left, merge up, split, and validate are available in the command palette. A merge from a non-empty cell explains the refusal and preserves source.

<!-- section: diagnostics -->
## Diagnostics

Invalid structures get a red edge and a readable reason. Reading view keeps its original table, and the editor never conceals invalid source.

<!-- section: settings -->
## Settings

Use native Obsidian controls and top tabs for Views and Appearance. Labels and descriptions support automatic, English, and Simplified Chinese languages.
