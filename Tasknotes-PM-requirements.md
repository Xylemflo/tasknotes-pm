# Tasknotes-PM — Requirements Draft

**Status:** Draft for approval  
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
3. The updater must not alter a valid user-supplied duration.
4. Invalid duration values are treated as 24 hours and reported in the run summary; they are not silently replaced unless the user explicitly requests normalization in a future setting.

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

   A project’s own duration is not added to this project roll-up; the 24-hour parent buffer is the defined project completion allowance.
3. Nested projects are evaluated from deepest child toward the root so a nested project’s calculated due date becomes the completion date used by its parent.
4. When a task has both ordinary prerequisites and project-child prerequisites, calculate the date that satisfies all prerequisites—the latest resulting completion date wins.
5. A task with no due date and no schedulable predecessor cannot receive a computed due date solely from its duration. It is listed as unscheduled in the result summary.
6. The updater must not move a calculated due date earlier than an explicit due date unless an approved setting expressly permits date compression. **Proposed default:** only extend dates (never pull work earlier).
7. Completed/archived tasks are read as predecessors when linked but their own due dates are not recalculated by default. They still constrain successors by their recorded due date.

### 4.4 Update command and start-up behavior

1. Register the command **`Tasknotes-PM: Update Project Dates`** in the Obsidian Command Palette.
2. Run the same update once after Obsidian starts and TaskNotes is available. The run must wait for the workspace and TaskNotes API to be ready.
3. Prevent overlapping runs. A request made while another update is active should report that an update is already running rather than race frontmatter writes.
4. Show a concise Obsidian notice at completion with counts for scanned tasks, dependencies synchronized, dates changed, skipped/unscheduled tasks, and errors.
5. Make changes through TaskNotes/Obsidian APIs so files, metadata cache, Bases, and TaskNotes views refresh normally.
6. If TaskNotes is absent, disabled, or does not expose the required public API, show a clear actionable notice and make no changes.

### 4.5 Kanban treatment

1. In TaskNotes Kanban views, a card for any task that currently has direct subtasks must use a dark-purple background.
2. A nested task uses dark purple only when it itself has subtasks; merely being a child of a project does not make it a project card.
3. The styling must preserve readable foreground text, status controls, icons, keyboard focus, hover state, and the user’s light/dark theme contrast.
4. Apply the style without changing a task’s status, tags, priority, or any TaskNotes data unrelated to this feature.
5. The implementation may use a plugin-owned CSS class and a small, documented marker property only if TaskNotes’ Bases/Kanban renderer cannot reliably expose the project state. The marker must be maintained by the updater and be opt-out/configurable.

## 5. User-facing settings

The initial settings screen should provide:

1. Duration property name, default `duration`.
2. Default duration in hours, default `24`.
3. Parent completion buffer in hours, default `24`.
4. Dependency gap in hours, default `24`.
5. Date policy: proposed default **extend-only**, with an optional future/advanced choice to recalculate exact dates and allow earlier dates.
6. Start-up update enabled, default on.
7. Kanban project-card highlighting enabled, default on.

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
7. A project task’s Kanban card is dark purple; an ordinary task’s card is not.
8. Cycles and unresolved links do not cause partial corrupt dependency rewrites or a loop.

## 8. Critical concerns and decisions required before build

### A. Hour durations versus TaskNotes date-only due field — approval required

TaskNotes documents `due` as an ISO date (for example `2026-10-26`), while `scheduled` supports a date-time. A 4-hour or 12-hour duration cannot be represented exactly in a date-only due field. The build needs one approved policy:

1. **Recommended:** use date-time values for calculated due dates if TaskNotes accepts and displays them correctly; otherwise retain the time in a Tasknotes-PM-specific completion timestamp while exposing a date-only `due` value.
2. Keep TaskNotes due dates date-only and round calculated results up to the next calendar day. This loses intraday precision but keeps the default TaskNotes presentation.
3. Limit the first release to 24-hour increments despite accepting a numeric hours field.

### B. User-authored due dates versus calculated due dates — approval required

The proposed extend-only policy preserves manual deadlines but means a manually late child can push dates later, while a manually early child is never pulled earlier by a new calculation. Exact recalculation gives a purer schedule but overwrites manual changes. The preferred default is **extend-only** with a clearly labelled exact-recalculate setting/command added later.

### C. Removing managed dependencies — approval required

TaskNotes does not distinguish a dependency created by this plugin from an identical dependency created by a user. To safely remove a relationship when a task stops being a subtask, Tasknotes-PM needs either:

1. a hidden/plugin-owned marker that records the relationship it created; or
2. a conservative policy that never removes dependencies automatically.

The recommended first release is the conservative policy; it prevents accidental deletion but can leave former parent/child blockers for the user to remove.

### D. Multiple parents — approval required

TaskNotes allows a child task to be assigned to several `projects`. Under this specification, the child blocks every parent. This is consistent but may create unexpected critical paths. The alternative is to flag multi-parent tasks and require the user to choose one scheduling parent.

### E. Dependency semantics

TaskNotes preserves relationship types and gaps, but its current built-in blocking behavior does not itself perform relationship-type-specific scheduling. Tasknotes-PM will schedule only `FINISHTOSTART` in version 1 and treat a missing type as `FINISHTOSTART`. Other types (`FINISHTOFINISH`, `STARTTOSTART`, `STARTTOFINISH`) must be preserved but reported as unsupported rather than silently interpreted.

### F. Kanban implementation risk

TaskNotes v4 Kanban is rendered through Obsidian Bases. Whether a third-party plugin can safely apply a per-card class must be confirmed against the installed TaskNotes and Obsidian versions. The fallback is a plugin-managed `isProject: true` property with a documented Bases/CSS rule. This is visually reliable, but adds a visible custom field unless hidden in the user’s view configuration.

### G. Start-up writes and vault synchronization

The requested automatic start-up run can change many task files immediately after opening a vault. This can create sync conflicts when the same vault is open on multiple devices. The build should run only after TaskNotes is ready, skip an update during active file conflicts, and make the startup switch easy to disable. A manual command remains available at all times.

## 9. Out of scope for version 1

- Gantt charts, resource allocation, critical-path visualization, or auto-scheduling from “today.”
- Business days, holidays, working hours, time zones beyond the user’s local Obsidian time zone, and duration units other than hours.
- Automatically creating task notes, projects, or subtasks.
- Editing TaskNotes’ core views or TaskNotes’ own source code.
- Recurrence-aware project forecasting beyond treating a materialized occurrence as an ordinary task.
- Background updates while Obsidian is closed.

## 10. Implementation readiness

After the decisions in Section 8 are approved, implementation can proceed as a standalone TypeScript Obsidian plugin with TaskNotes as a required peer plugin. The first engineering milestone will validate the installed TaskNotes API and Bases Kanban rendering surface before any scheduling mutations are enabled.
