# Tasknotes-PM

Tasknotes-PM is an Obsidian companion plugin for [TaskNotes](https://tasknotes.dev/obsidian/). It discovers TaskNotes project hierarchies, schedules finish-to-start dependencies, and highlights project cards in TaskNotes Kanban views.

## Privacy

Tasknotes-PM works entirely within the active vault. It does not make network requests, collect analytics, or transmit task data itself. When its Google Calendar sync is enabled, it asks the installed TaskNotes plugin to run TaskNotes' own local Google Calendar sync; TaskNotes retains all OAuth credentials and calendar settings.

## Requirements

- Obsidian 1.12.2 or newer.
- TaskNotes with runtime API v1 and the `tasks.read`, `tasks.write`, and `relationships.read` capabilities. TaskNotes must be enabled before Tasknotes-PM.
- For Google Calendar syncing: a connected Google account and **Enable task export** in `Settings → TaskNotes → Integrations`. TaskNotes controls the target calendar, date trigger, event format, and eligible task export behavior.

## What it changes

- A task becomes a project when another TaskNotes task links to it through `projects`.
- Each direct subtask is added as a finish-to-start prerequisite of its parent.
- Missing `duration` values are written as `24` hours.
- A project due date becomes its latest direct subtask completion plus 24 hours.
- A normal finish-to-start successor is scheduled after the latest predecessor due date, plus a 24-hour gap and the successor duration.
- Calculations are extend-only: due dates are never moved earlier.
- Exact calculated times are retained in `tasknotesPmCompletion`; TaskNotes receives a date-only `due` value for normal display.
- Each project and its direct child cards receive the same high-contrast HSL color in TaskNotes Kanban views. Tasknotes-PM balances the active project groups across the color wheel once, then preserves their saved hues while assigning new projects the most distinct available color. The hue is saved in the task notes' `tasknotesPmProjectColor` frontmatter, so it follows the vault to synced devices. Nested projects receive their own color for their own direct children.
- This replaces the need for the separate **TaskNotes Project Colors** plugin.

The plugin intentionally does not remove a dependency when a task stops being a subtask. This prevents it from deleting a relationship that a user may have created independently.

## Use

After enabling Tasknotes-PM, run **Tasknotes-PM: Update Project Dates** from the Command Palette. It also runs once when Obsidian opens, after TaskNotes is ready; this can be disabled in the Tasknotes-PM settings.

The project-date update then dispatches TaskNotes' built-in **Sync all tasks** action, so TaskNotes refreshes the Google Calendar events for the vault's open tasks on every device that opens the vault. You can control startup and post-update syncing independently, or run **Tasknotes-PM: Sync Open Tasks to Google Calendar** manually. This uses no GitHub workflow, token, or scheduler.

Each run reports scan, prerequisite, date-update, unscheduled, cycle, and error counts. Cyclic or unresolved relationships are left untouched.

## ChatGPT skill

The reusable skill source lives in [`skills/tasknotes-pm`](skills/tasknotes-pm/SKILL.md). Once installed, invoke it as **`$tasknotes-pm`** to review or update a TaskNotes vault directly from ChatGPT. It uses the same frontmatter contract as the plugin, including the sync-safe `tasknotesPmProjectColor` property.

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
