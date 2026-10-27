# Tasknotes-PM

Tasknotes-PM is an Obsidian companion plugin for [TaskNotes](https://tasknotes.dev/obsidian/). It discovers TaskNotes project hierarchies, schedules finish-to-start dependencies, and highlights project cards in TaskNotes Kanban views.

## Privacy

Tasknotes-PM works entirely within the active vault. It does not make network requests, collect analytics, or transmit task data.

## Requirements

- Obsidian 1.12.2 or newer.
- TaskNotes with runtime API v1 and the `tasks.read`, `tasks.write`, and `relationships.read` capabilities. TaskNotes must be enabled before Tasknotes-PM.

## What it changes

- A task becomes a project when another TaskNotes task links to it through `projects`.
- Each direct subtask is added as a finish-to-start prerequisite of its parent.
- Missing `duration` values are written as `24` hours.
- A project due date becomes its latest direct subtask completion plus 24 hours.
- A normal finish-to-start successor is scheduled after the latest predecessor due date, plus a 24-hour gap and the successor duration.
- Calculations are extend-only: due dates are never moved earlier.
- Exact calculated times are retained in `tasknotesPmCompletion`; TaskNotes receives a date-only `due` value for normal display.
- Project cards receive a dark-purple background in TaskNotes Kanban views.

The plugin intentionally does not remove a dependency when a task stops being a subtask. This prevents it from deleting a relationship that a user may have created independently.

## Use

After enabling Tasknotes-PM, run **Tasknotes-PM: Update Project Dates** from the Command Palette. It also runs once when Obsidian opens, after TaskNotes is ready; this can be disabled in the Tasknotes-PM settings.

Each run reports scan, prerequisite, date-update, unscheduled, cycle, and error counts. Cyclic or unresolved relationships are left untouched.

## Support

Report bugs and feature requests through the [GitHub issue tracker](https://github.com/Xylemflo/tasknotes-pm/issues). Include the TaskNotes and Obsidian versions, the task relationship involved, and any relevant console errors.

## Development

```sh
pnpm install
pnpm check
pnpm build
pnpm release:check
```

The release files are `main.js`, `manifest.json`, and `styles.css`.

## Releasing

See [RELEASING.md](RELEASING.md) for the GitHub and Obsidian Community Directory release process.

See [Tasknotes-PM-requirements.md](Tasknotes-PM-requirements.md) for the approved functional requirements and limitations.
