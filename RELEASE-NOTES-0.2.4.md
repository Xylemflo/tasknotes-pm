# Tasknotes-PM 0.2.4

Release date: 2026-11-27

## Fixed

- Keeps an open Gantt view in its current workspace location when the plugin unloads or reloads.
- Adds searchable settings definitions for Obsidian 1.13 and later while retaining the Obsidian 1.12 settings UI.
- Replaces CSS `!important` declarations with scoped selectors.

## Verification

- Source changes directly address the Obsidian Community review failure for 0.2.3.
- GitHub Actions rebuilds the release assets, verifies the TypeScript source, and creates provenance attestations before publishing the release files.
