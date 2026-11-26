# Tasknotes-PM 0.2.3

Release date: 2026-11-26

## Changed

- Calculates exact parent due dates from active direct children only.
- Preserves an open parent's due date when no active children remain.
- Allows fully scheduled active children to move a parent earlier or later.
- Prevents an unresolved or undated active child from compressing its parent date.
- Excludes completed and archived children from hard-deadline backward scheduling.
- Extends Gantt parent bars through the parent's preserved due date.

## Known limitation

- Removing a project relationship does not remove a prerequisite previously created by Tasknotes-PM. That retained dependency may still extend the former parent until dependency provenance and safe removal are supported.
