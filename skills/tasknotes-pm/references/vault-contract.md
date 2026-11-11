# TaskNotes vault contract

## Relationship and schedule rules

- A child points at a project through its `projects` frontmatter relationship.
- Each direct child is a finish-to-start predecessor of its parent. Preserve any unrelated user-created dependency.
- A missing or invalid `duration` is treated as 24 hours for calculations. A valid duration is never overwritten.
- Store exact calculated completion time in `tasknotesPmCompletion` as an ISO timestamp. The TaskNotes `due` field remains a calendar date.
- Project completion is the latest direct child completion plus 24 hours. A normal finish-to-start successor is the latest predecessor due date plus a 24-hour gap and the successor duration.
- Do not move a date earlier unless the user explicitly asks for exact recalculation. Completed and archived tasks may constrain successors but are not recalculated.
- Report and leave untouched unresolved relationships and dependency cycles.

## Persistent color rule

The `tasknotesPmProjectColor` property is a number from 0 through 359. Tasknotes-PM distributes a vault's current project groups across the color wheel during its initial color migration, using each vault-relative project path's unsigned DJB2 hash as a stable ordering key. It interleaves that order so adjacent paths receive distant colors.

After migration, retain a valid saved project hue. When a new project needs a color, choose the available 20-degree candidate that maximizes its minimum circular distance from existing project hues; break ties by its DJB2-derived preferred hue. This prevents similar new colors while preserving established group colors.

Save each project's hue on the project note and on every direct child. Tasknotes-PM reads this property to render a light or dark HSL card color. Because the property lives in Markdown frontmatter, the color survives vault sync and does not rely on another color plugin or a local plugin database.
