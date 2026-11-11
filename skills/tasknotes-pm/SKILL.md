---
name: tasknotes-pm
description: "Review or update TaskNotes project schedules and persistent project colors in an Obsidian vault. Use when managing task hierarchies, dependencies, due dates, or project color metadata; not for unrelated notes."
---

# TaskNotes Project Manager

Use the task notes' YAML frontmatter as the source of truth. The skill must work without the TaskNotes Project Colors plugin and must make saved changes portable through normal vault sync.

## Scope and safety

- Work only in the vault the user identifies. If no vault is identified, ask for its path before making changes.
- Read the relevant tasks and report the proposed changes before a broad write. Apply changes when the user asks to update, synchronize, or fix the vault; otherwise keep the work read-only.
- Preserve unrelated YAML, user-written dependencies, valid durations, and explicit deadlines. Do not delete dependencies merely because a child no longer names a project.
- Treat a task with one or more direct children as a project. A child names its parent through the TaskNotes `projects` relationship.

## Project color workflow

Use the persisted property `tasknotesPmProjectColor` unless the user explicitly supplies another property name. Its value is an integer HSL hue from 0 through 359.

1. Resolve every direct parent/child relationship.
2. Give every project a distinct persisted hue using the strategy in [the vault contract](references/vault-contract.md). Newly created project groups take the most separated available hue; existing saved colors remain stable.
3. Save the project’s hue on the project and each of its direct children. This makes the data portable to other synced devices.
4. A nested project uses its own hue for itself and its direct children. When a task belongs to several projects, choose the alphabetically first parent for its one visible card color and report that choice.
5. Do not remove a stale color property automatically; report it if cleanup is requested.

## Scheduling workflow

For date or dependency changes, read [the vault contract](references/vault-contract.md). Use its extend-only scheduling policy unless the user explicitly approves a different policy. Preview the affected tasks, unscheduled tasks, cycles, and any multi-parent color choices before a large update.

When changes are applied, finish with a concise summary of changed notes, dependencies, dates, and project colors. Mention that visual card coloring is supplied by Tasknotes-PM itself; TaskNotes Project Colors is not required.
