# Tasknotes-PM

Tasknotes-PM is an Obsidian companion plugin for [TaskNotes](https://tasknotes.dev/obsidian/). It discovers TaskNotes project hierarchies, schedules finish-to-start dependencies, enforces project deadlines, provides a Gantt timeline, and retains project colors across views.

## Privacy

Tasknotes-PM works entirely within the active vault. It does not make network requests, collect analytics, or transmit task data itself. When Google Calendar sync is enabled, it asks the installed TaskNotes plugin to run TaskNotes' own local Google Calendar sync; TaskNotes retains all OAuth credentials and calendar settings.

## Requirements

- Obsidian 1.12.2 or newer.
- TaskNotes with runtime API v1 and the `tasks.read`, `tasks.write`, and `relationships.read` capabilities. TaskNotes must be enabled before Tasknotes-PM.
- For Google Calendar syncing: a connected Google account and **Enable task export** in `Settings → TaskNotes → Integrations`. TaskNotes controls the target calendar, date trigger, event format, and eligible task export behavior.

## What it changes

- A task becomes a project when another TaskNotes task links to it through `projects`.
- Each direct subtask is added as a finish-to-start prerequisite of its parent.
- Missing child `duration` values are written as `24` hours.
- A parent duration is recalculated as the complete span from its earliest child's start through its latest child's completion.
- A parent with active children is due one day after its latest active direct child. Completed and archived children are ignored; when no active children remain, the existing parent due date is preserved.
- A parent with `hardDeadline: YYYY-MM-DD` is due on that deadline and its children are scheduled backward, in existing due-date order, so the final child completes one day before the deadline.
- Existing child dates that already fit the backward schedule are preserved.
- If the required work begins before today, the plugin warns and follows the configured policy: honor the deadline and allow overdue tasks, or move the deadline and parent due date forward.
- A normal finish-to-start successor is scheduled after the latest predecessor due date, plus a 24-hour gap and the successor duration.
- Ordinary dependency calculations remain extend-only. Fully scheduled active-child rollups are exact and may move a parent earlier or later. Hard deadlines remain authoritative.
- Exact calculated times are retained in `tasknotesPmCompletion`; TaskNotes receives a date-only `due` value for normal display.
- Project cards and their children retain their persisted exact hex colors in TaskNotes Kanban and Tasknotes-PM Gantt views. The first ten colors use the approved categorical palette; later colors maximize perceptual distance from all colors already in use.

The plugin intentionally does not remove a dependency when a task stops being a subtask. This prevents it from deleting a relationship that a user may have created independently.

## Use

After enabling Tasknotes-PM, run **Tasknotes-PM: Update Project Dates** from the Command Palette. It also runs once when Obsidian opens, after TaskNotes is ready; this can be disabled in the Tasknotes-PM settings.

The project-date update can dispatch TaskNotes' built-in **Sync all tasks** action so TaskNotes refreshes Google Calendar events for the vault's open tasks. Startup and post-update syncing can be controlled independently, or **Tasknotes-PM: Sync Open Tasks to Google Calendar** can be run manually.

Run **Tasknotes-PM: Open Gantt View** to open the timeline. Use the selector to show one project or all open projects. Nested tasks are included, parent bars extend through their preserved due dates, each bar uses its persisted project color, and the header is divided into weekly intervals. Select a task name or timeline bar to open its TaskNote.

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
