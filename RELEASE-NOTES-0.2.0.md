# Tasknotes-PM 0.2.0

Released: 2026-11-26

## New

- Recalculates each parent duration from the complete span of its children.
- Sets a normal parent's due date to the latest child due date plus one day.
- Supports `hardDeadline` scheduling, working backward from the deadline while preserving already compliant child dates.
- Warns when a hard-deadline schedule would begin before today and supports either immediate overdue tasks or moving the parent deadline forward.
- Adds a native Gantt view for one project or all open projects.
- Preserves project colors throughout the Gantt timeline.
- Adds weekly timeline ticks and grid intervals.
- Opens the corresponding TaskNote when a task name or timeline bar is selected.

## Validation

- TypeScript validation and production build passed.
- Scheduling, hard-deadline behavior, project coloration, weekly Gantt ticks, and both Gantt link targets were tested in a copied local vault.
