# Tasknotes-PM — Requirements

**Status:** Implemented through version 0.2.0  
**Updated:** 2026-11-26  
**Target:** An Obsidian community plugin that complements TaskNotes 4.14+  
**Working name / plugin ID:** `tasknotes-pm`

## 1. Purpose

Tasknotes-PM adds lightweight project scheduling to a TaskNotes vault. It treats a TaskNotes task as a **project** when one or more other TaskNotes tasks list it in their `projects` frontmatter property (that is, it has subtasks). It calculates project and dependency dates, and visually distinguishes project tasks in TaskNotes Kanban views.

TaskNotes remains the system of record: task notes and their YAML frontmatter are the only persisted data. Tasknotes-PM will use TaskNotes’ public runtime API where available, so TaskNotes continues to own relationship resolution and its configurable property mappings.

## 2. Definitions

| Term | Meaning |
| --- | --- |
| Task | A TaskNotes task note. |
| Parent / project | A task with at least one direct subtask. |
| Subtask / child | A task whose `projects` list links to the parent task. |
| Direct subtask | A task linked to a parent by one `projects` relationship. A nested project is both a child of its parent and the parent of its own subtasks. |
| Duration | Estimated work length in hours, stored in a task’s frontmatter. |
| Completion / due date | The task’s calculated planned finish date, held in TaskNotes’ configured due-date field. |
| Predecessor | A task that must finish before its successor can start. |

## 3. Frontmatter contract

Tasknotes-PM adds one custom property to every task it updates:

```yaml
duration: 24
```

`duration` is a positive number of hours. It defaults to `24` when missing, blank, zero, negative, or invalid. The first release does not support minutes, days, business calendars, or working-hours calendars.

TaskNotes properties are used as follows:

```yaml
# A child task: TaskNotes already interprets this as a subtask of Project Alpha.
projects:
  - "[[Project Alpha]]"

# The child must complete before Project Alpha may complete.
blocking:
  - "[[Project Alpha]]"

# Matching reverse relationship on Project Alpha.
blockedBy:
  - uid: "[[Child task]]"
    reltype: FINISHTOSTART
```

The actual serialized relationship shape will be written through the TaskNotes API, not hand-built YAML. This is important because TaskNotes keeps `blockedBy` and `blocking` reciprocal and property names may be remapped in TaskNotes settings.

## 4. Functional requirements

### 4.1 Project discovery and parent/child prerequisites

1. On each update run, discover all TaskNotes tasks and resolve their direct parents and subtasks through TaskNotes’ relationship API.
2. A task with one or more direct subtasks is a project.
3. Every direct subtask is a finish-to-start predecessor of its parent:
   - add or retain a `blockedBy` dependency on the parent for the child;
   - add or retain the corresponding `blocking` relationship on the child;
   - assign `FINISHTOSTART` where TaskNotes supports a relationship type.
4. The update must be idempotent: a second unchanged run creates no duplicate relationships and no unnecessary file writes.
5. Existing user-created dependencies must be retained. Tasknotes-PM adds only the parent/child prerequisite it manages; it must not replace unrelated `blockedBy` or `blocking` entries.
6. Removing a subtask from a parent must remove only the matching, Tasknotes-PM-managed dependency. The plugin must not remove an indistinguishable user-created dependency without a clear ownership rule (see Open Decisions).

### 4.2 Duration

1. Add `duration` to frontmatter for tasks that Tasknotes-PM creates or modifies, using `24` when absent.
2. A supplied numeric duration is interpreted as hours.
3. Preserve a valid user-supplied duration for an ordinary task.
4. Recalculate every schedulable parent's duration as the elapsed span from the earliest direct child's implicit start through the latest direct child's completion. Resolve nested parent durations deepest-first.
5. Invalid duration values are treated as 24 hours and reported in the run summary.

### 4.3 Date calculations

The calculations use **finish-to-start** scheduling. A due date is the task’s planned completion. The implicit planned start is `due − duration`.

1. For every task with one or more prerequisites, calculate its due date as:

   ```text
   max(predecessor due date) + 24 hours + target duration
   ```

   This applies whether the prerequisite appears as the target task’s `blockedBy` relationship or as another task’s reciprocal `blocking` relationship.
2. For a project, calculate its due date as:

   ```text
   latest direct-subtask completion date + 24 hours
   ```

   The one-day allowance is fixed. The project's recalculated duration describes the child-work span and is not added again.
3. Nested projects are evaluated from deepest child toward the root so a nested project’s calculated due date becomes the completion date used by its parent.
4. When a task has both ordinary prerequisites and project-child prerequisites, calculate the date that satisfies all prerequisites—the latest resulting completion date wins.
5. A task with no due date and no schedulable predecessor cannot receive a computed due date solely from its duration. It is listed as unscheduled in the result summary.
6. The updater must not move a calculated due date earlier than an explicit due date unless an approved setting expressly permits date compression. **Proposed default:** only extend dates (never pull work earlier).
7. Completed/archived tasks are read as predecessors when linked but their own due dates are not recalculated by default. They still constrain successors by their recorded due date.

### 4.3.1 Hard deadlines and backward scheduling

1. The configurable frontmatter property `hardDeadline` accepts an ISO date (`YYYY-MM-DD`) on a parent task.
2. A hard-deadline parent is due on that date instead of one day after the latest currently dated child.
3. Schedule direct children backward from one day before the hard deadline, subtracting each child's duration. Use current due-date order, then path order for deterministic ties or missing dates.
4. Retain an existing child due date when it already fits at or before its allowable backward-schedule position. Move only missing or noncompliant dates unless the conflict policy requires a full shift.
5. Apply backward scheduling recursively through nested projects so every descendant completes within its containing project span.
6. Warn when the calculated work span begins before the current local date.
7. Provide two policies: honor the hard deadline and permit immediately overdue tasks, or move the hard deadline and parent due date forward by whole days until work can begin today.

### 4.4 Update command and start-up behavior

1. Register the command **`Tasknotes-PM: Update Project Dates`** in the Obsidian Command Palette.
2. Run the same update once after Obsidian starts and TaskNotes is available. The run must wait for the workspace and TaskNotes API to be ready.
3. Prevent overlapping runs. A request made while another update is active should report that an update is already running rather than race frontmatter writes.
4. Show a concise Obsidian notice at completion with counts for scanned tasks, dependencies synchronized, dates changed, skipped/unscheduled tasks, and errors.
5. Make changes through TaskNotes/Obsidian APIs so files, metadata cache, Bases, and TaskNotes views refresh normally.
6. If TaskNotes is absent, disabled, or does not expose the required public API, show a clear actionable notice and make no changes.

### 4.5 Kanban treatment

1. In TaskNotes Kanban views, a project and its direct children use the project's persisted color.
2. A nested project uses its own persisted color for itself and its direct children.
3. The styling must preserve readable foreground text, status controls, icons, keyboard focus, hover state, and the user’s light/dark theme contrast.
4. Apply the style without changing a task’s status, tags, priority, or any TaskNotes data unrelated to this feature.
5. The implementation may use a plugin-owned CSS class and a small, documented marker property only if TaskNotes’ Bases/Kanban renderer cannot reliably expose the project state. The marker must be maintained by the updater and be opt-out/configurable.

### 4.6 Gantt timeline

1. Register **`Tasknotes-PM: Open Gantt View`** as a native Obsidian view command.
2. Allow the view to display either one selected project or all open projects.
3. Show nested project tasks recursively with parent/child indentation.
4. Derive each bar's start from `completion − duration` and render parent bars across their calculated child span.
5. Use the persisted project hue for every project and task bar.
6. Render weekly tick marks in the timeline header, aligned with the weekly chart grid.
7. Make every task name and timeline bar a link to that task's TaskNote.

## 5. User-facing settings

The initial settings screen should provide:

1. Duration property name, default `duration`.
2. Default duration in hours, default `24`.
3. Dependency gap in hours, default `24`.
4. Date policy: ordinary dependencies are **extend-only**; parent rollups and hard-deadline schedules are exact.
5. Start-up update enabled, default on.
6. Kanban project-card highlighting enabled, default on.
7. Hard-deadline property name, default `hardDeadline`.
8. Hard-deadline conflict policy: honor deadline/create overdue tasks (default), or move deadline forward.

The parent completion allowance is fixed at one day in version 0.2.0; the former configurable project-buffer setting is no longer exposed.

Changing defaults affects subsequent calculations; it does not rewrite every task until the next explicit or start-up update.

## 6. Errors, validation, and safety

1. Detect dependency cycles, including cycles created by parent/child relationships. Do not calculate or write dates for tasks in a cycle; report the task paths and relationship chain.
2. Detect unresolved, deleted, or non-TaskNotes note links. Leave those links untouched and report them.
3. Validate numeric duration values and malformed relationships before writing.
4. Batch and sequence writes to avoid update storms from Obsidian metadata events. Writes made by the plugin must not trigger an endless recalculation loop.
5. If one task cannot be updated, continue independent calculations where safe and show an error summary at the end.
6. Provide diagnostic logging in Obsidian’s developer console, without storing a second task database.

## 7. Acceptance criteria

1. Given a parent task with two dated subtasks, the parent is recognized as a project, its two children block it, and its due date becomes the later child due date plus 24 hours.
2. Given a task A with `blocking` task B, or task B with `blockedBy` task A, B’s due date is no earlier than A’s due date plus 24 hours plus B’s duration.
3. Given a three-level hierarchy, dates are recalculated deepest-first and roll up correctly to the top-level project.
4. A task without a `duration` receives the default scheduling value of 24 hours without overwriting a valid explicit value.
5. The command produces the same result as the start-up update and is safe to run repeatedly.
6. Existing unrelated TaskNotes dependencies survive an update unchanged.
7. Project and child cards retain their persisted project hues in Kanban views.
8. Cycles and unresolved links do not cause partial corrupt dependency rewrites or a loop.
9. A parent's duration equals the complete span of its dated children and its due date equals the latest child due date plus one day.
10. A hard-deadline parent retains that deadline as its due date and its children are back-scheduled without changing already compliant dates.
11. A hard-deadline schedule that starts before today warns and follows the selected conflict policy.
12. The Gantt view can switch between a single project and all open projects, includes nested children, renders weekly header ticks, retains persisted project hues, and opens the correct TaskNote from either its name or timeline bar.

## 8. Resolved design decisions and current constraints

### A. Hour durations versus TaskNotes date-only due field

TaskNotes receives a date-only `due` value. Tasknotes-PM retains the exact calculated instant in `tasknotesPmCompletion`, preserving sub-day durations for subsequent calculations.

### B. User-authored due dates versus calculated due dates

Ordinary dependencies remain extend-only. Parent rollups are exact because their dates are derived from children. Hard-deadline assignments are exact for missing or noncompliant child dates; already compliant dates remain unchanged.

### C. Removing managed dependencies

Tasknotes-PM never removes dependencies automatically because TaskNotes does not distinguish plugin-created relationships from identical user-created relationships.

### D. Multiple parents

One child blocks every parent to which TaskNotes assigns it. If multiple hard deadlines constrain the same child, the earliest required completion wins.

### E. Dependency semantics

Tasknotes-PM schedules only `FINISHTOSTART` and treats a missing type as `FINISHTOSTART`. Other types are preserved but not interpreted.

### F. Kanban implementation risk

TaskNotes Kanban cards are styled with plugin-owned CSS classes and persisted hue metadata. Card matching still depends on TaskNotes' rendered card attributes and metadata.

### G. Start-up writes and vault synchronization

The requested automatic start-up run can change many task files immediately after opening a vault. This can create sync conflicts when the same vault is open on multiple devices. The build should run only after TaskNotes is ready, skip an update during active file conflicts, and make the startup switch easy to disable. A manual command remains available at all times.

## 9. Out of scope for version 1

- Resource allocation, critical-path visualization, drag-to-reschedule, or dependency arrows in the Gantt view.
- Business days, holidays, working hours, time zones beyond the user’s local Obsidian time zone, and duration units other than hours.
- Automatically creating task notes, projects, or subtasks.
- Editing TaskNotes’ core views or TaskNotes’ own source code.
- Recurrence-aware project forecasting beyond treating a materialized occurrence as an ordinary task.
- Background updates while Obsidian is closed.

## 10. Implementation readiness

Version 0.2.0 implements the scheduling, hard-deadline, project-color, and Gantt requirements as a standalone TypeScript Obsidian plugin with TaskNotes as a required peer plugin.
