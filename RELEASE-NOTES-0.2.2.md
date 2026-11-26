# Tasknotes-PM 0.2.2

Released: 2026-11-26

## Changed

- Migrates active projects from numeric HSL hues to the approved ten-color exact-hex palette.
- Assigns any additional project colors by maximizing minimum OKLab distance from all colors already in use.
- Keeps assigned project colors stable across restarts and synced devices after the one-time migration.
- Uses the same exact color identity in TaskNotes Kanban cards and the Tasknotes-PM Gantt view.

## Fixed

- Removes plugin-owned color metadata when a task no longer belongs to a project.
- Prevents completed or active dependency links by themselves from assigning a project color.
- Repairs duplicate persisted project colors by reallocating the later project to a distinct color.

## Validation

- TypeScript validation and the production build passed.
- The approved palette, normalization, uniqueness, extended-color allocation, and CSS variable migration were checked automatically.
- The built plugin was staged in the copied local vault; no live-vault files were changed.
