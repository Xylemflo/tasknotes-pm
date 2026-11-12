import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, TasknotesPmSettingTab, type TasknotesPmSettings } from "./settings";
import type { MutationContext, ResolvedDependency, TaskInfo, TaskNotesApi, TaskNotesPlugin } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const PLUGIN_SOURCE = "tasknotes-pm";
const DISTINCT_COLOR_SCHEME_VERSION = 1;

type TaskState = {
  durationHours: number;
  completionMs: number | null;
  isCompletedOrArchived: boolean;
};

type RunSummary = {
  scanned: number;
  openTasks: number;
  dependenciesAdded: number;
  datesChanged: number;
  defaultsAdded: number;
  colorsAssigned: number;
  calendarSync: CalendarSyncStatus;
  invalidDurations: string[];
  unscheduled: string[];
  cycles: string[][];
  errors: string[];
};

type CalendarSyncStatus = "not-run" | "synced" | "skipped" | "unavailable" | "failed" | "busy";

type CalendarSyncResult = {
  status: CalendarSyncStatus;
  openTasks: number;
  detail?: string;
};

type RegisteredCommand = {
  id: string;
  name: string;
};

type CommandRegistry = {
  commands: Record<string, RegisteredCommand>;
  executeCommandById(id: string): boolean | Promise<boolean>;
};

export default class TasknotesPmPlugin extends Plugin {
  settings: TasknotesPmSettings = DEFAULT_SETTINGS;
  private updateInProgress = false;
  private calendarSyncInProgress = false;
  private projectColorHues = new Map<string, number>();
  private cardObserver: MutationObserver | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new TasknotesPmSettingTab(this.app, this));
    this.addCommand({
      id: "update-project-dates",
      name: "Update Project Dates",
      callback: () => void this.updateProjectDates(false),
    });
    this.addCommand({
      id: "sync-open-tasks-to-google-calendar",
      name: "Sync Open Tasks to Google Calendar",
      callback: () => void this.syncOpenTasksToGoogleCalendar(false, true),
    });

    this.installKanbanObserver();
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.updateOnStartup) {
        void this.updateProjectDates(true);
      } else if (this.settings.syncGoogleCalendarOnStartup) {
        void this.syncOpenTasksToGoogleCalendar(true, false);
      }
    });
  }

  onunload(): void {
    this.cardObserver?.disconnect();
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...this.validSettings(await this.loadData() as unknown) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private validSettings(value: unknown): Partial<TasknotesPmSettings> {
    if (!this.isRecord(value)) return {};
    const positiveNumber = (key: keyof TasknotesPmSettings): number | undefined => {
      const candidate = value[key];
      return typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0 ? candidate : undefined;
    };
    const boolean = (key: keyof TasknotesPmSettings): boolean | undefined =>
      typeof value[key] === "boolean" ? value[key] : undefined;
    const text = (key: keyof TasknotesPmSettings): string | undefined =>
      typeof value[key] === "string" && value[key].trim() ? value[key].trim() : undefined;

    const settings: Partial<TasknotesPmSettings> = {};
    const durationProperty = text("durationProperty");
    const completionProperty = text("completionProperty");
    const projectColorProperty = text("projectColorProperty");
    const projectColorSchemeVersion = positiveNumber("projectColorSchemeVersion");
    const defaultDurationHours = positiveNumber("defaultDurationHours");
    const dependencyGapHours = positiveNumber("dependencyGapHours");
    const projectBufferHours = positiveNumber("projectBufferHours");
    const updateOnStartup = boolean("updateOnStartup");
    const syncGoogleCalendarOnStartup = boolean("syncGoogleCalendarOnStartup");
    const syncGoogleCalendarOnUpdate = boolean("syncGoogleCalendarOnUpdate");
    const highlightProjectCards = boolean("highlightProjectCards");
    if (durationProperty !== undefined) settings.durationProperty = durationProperty;
    if (completionProperty !== undefined) settings.completionProperty = completionProperty;
    if (projectColorProperty !== undefined) settings.projectColorProperty = projectColorProperty;
    if (projectColorSchemeVersion !== undefined) settings.projectColorSchemeVersion = projectColorSchemeVersion;
    if (defaultDurationHours !== undefined) settings.defaultDurationHours = defaultDurationHours;
    if (dependencyGapHours !== undefined) settings.dependencyGapHours = dependencyGapHours;
    if (projectBufferHours !== undefined) settings.projectBufferHours = projectBufferHours;
    if (updateOnStartup !== undefined) settings.updateOnStartup = updateOnStartup;
    if (syncGoogleCalendarOnStartup !== undefined) settings.syncGoogleCalendarOnStartup = syncGoogleCalendarOnStartup;
    if (syncGoogleCalendarOnUpdate !== undefined) settings.syncGoogleCalendarOnUpdate = syncGoogleCalendarOnUpdate;
    if (highlightProjectCards !== undefined) settings.highlightProjectCards = highlightProjectCards;
    return settings;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  async updateProjectDates(startup: boolean): Promise<void> {
    if (this.updateInProgress) {
      if (!startup) new Notice("Tasknotes-PM: An update is already running.");
      return;
    }

    const api = await this.getTaskNotesApi();
    if (!api) {
      if (!startup) new Notice("Tasknotes-PM requires TaskNotes runtime API v1 with task and relationship access.");
      return;
    }

    this.updateInProgress = true;
    const summary: RunSummary = {
      scanned: 0, openTasks: 0, dependenciesAdded: 0, datesChanged: 0, defaultsAdded: 0, colorsAssigned: 0,
      calendarSync: "not-run",
      invalidDurations: [], unscheduled: [], cycles: [], errors: [],
    };

    try {
      await api.lifecycle.ready();
      const tasks = await api.tasks.list();
      summary.scanned = tasks.length;
      const completedStatuses = this.completedStatuses(api);
      summary.openTasks = this.openTasks(tasks, completedStatuses).length;
      const states = await this.createTaskStates(tasks, summary, completedStatuses);
      const childrenByParent = await this.loadChildren(api, tasks, summary);

      await this.writeDurationDefaults(states, summary);
      await this.syncProjectColors(tasks, childrenByParent, summary);
      await this.ensureParentDependencies(api, childrenByParent, summary);

      const dependencies = await this.loadDependencies(api, tasks, summary);
      const calculated = this.calculateDates(states, childrenByParent, dependencies, summary);
      await this.writeCalculatedDates(api, states, calculated, summary);
      this.refreshProjectCardStyles();

      const calendarSync = await this.runGoogleCalendarSync(tasks, completedStatuses, startup, false);
      summary.calendarSync = calendarSync.status;
      if (calendarSync.status === "failed" || calendarSync.status === "unavailable") {
        summary.errors.push(calendarSync.detail ?? "Google Calendar sync was unavailable.");
      }
    } catch (error) {
      console.error("Tasknotes-PM update failed", error);
      summary.errors.push(this.errorMessage(error));
    } finally {
      this.updateInProgress = false;
    }

    const detail = [
      `${summary.scanned} scanned`,
      `${summary.openTasks} open`,
      `${summary.dependenciesAdded} prerequisite${summary.dependenciesAdded === 1 ? "" : "s"} added`,
      `${summary.datesChanged} date${summary.datesChanged === 1 ? "" : "s"} updated`,
      summary.colorsAssigned ? `${summary.colorsAssigned} color${summary.colorsAssigned === 1 ? "" : "s"} assigned` : "",
      summary.calendarSync === "synced" ? "Google Calendar synced" : "",
      summary.calendarSync === "skipped" ? "Google Calendar sync skipped" : "",
      summary.calendarSync === "unavailable" ? "Google Calendar sync unavailable" : "",
      summary.unscheduled.length ? `${summary.unscheduled.length} unscheduled` : "",
      summary.cycles.length ? `${summary.cycles.length} cycle${summary.cycles.length === 1 ? "" : "s"}` : "",
      summary.errors.length ? `${summary.errors.length} error${summary.errors.length === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(" · ");
    new Notice(`Tasknotes-PM: ${detail}`, 7000);
  }

  /**
   * TaskNotes owns OAuth, calendar selection, and the mapping of task dates to
   * events. Dispatching its existing command keeps those credentials out of
   * Tasknotes-PM and works on each device where the vault opens.
   */
  private async syncOpenTasksToGoogleCalendar(startup: boolean, force: boolean): Promise<void> {
    const api = await this.getTaskNotesApi();
    if (!api) {
      if (!startup) new Notice("Tasknotes-PM requires TaskNotes before it can sync Google Calendar.");
      return;
    }

    try {
      await api.lifecycle.ready();
      const tasks = await api.tasks.list();
      const result = await this.runGoogleCalendarSync(tasks, this.completedStatuses(api), startup, force);
      if (!startup || result.status !== "synced") {
        new Notice(this.calendarSyncNotice(result), 7000);
      }
    } catch (error) {
      console.error("Tasknotes-PM Google Calendar sync failed", error);
      if (!startup) new Notice(`Tasknotes-PM: Google Calendar sync failed (${this.errorMessage(error)}).`, 7000);
    }
  }

  private async runGoogleCalendarSync(
    tasks: TaskInfo[],
    completedStatuses: Set<string>,
    startup: boolean,
    force: boolean,
  ): Promise<CalendarSyncResult> {
    const openTasks = this.openTasks(tasks, completedStatuses);
    const enabled = startup ? this.settings.syncGoogleCalendarOnStartup : this.settings.syncGoogleCalendarOnUpdate;
    if (!force && !enabled) return { status: "skipped", openTasks: openTasks.length };
    if (this.calendarSyncInProgress) return { status: "busy", openTasks: openTasks.length };

    const command = this.taskNotesCalendarSyncCommand();
    if (!command) {
      return {
        status: "unavailable",
        openTasks: openTasks.length,
        detail: "TaskNotes' Sync all tasks command was not found. Update TaskNotes and enable Google Calendar task export in TaskNotes settings.",
      };
    }

    this.calendarSyncInProgress = true;
    try {
      const accepted = await Promise.resolve(this.commandRegistry()?.executeCommandById(command.id));
      if (accepted === false) {
        return { status: "failed", openTasks: openTasks.length, detail: "TaskNotes did not accept the Google Calendar sync command." };
      }
      return { status: "synced", openTasks: openTasks.length };
    } catch (error) {
      return { status: "failed", openTasks: openTasks.length, detail: this.errorMessage(error) };
    } finally {
      this.calendarSyncInProgress = false;
    }
  }

  private commandRegistry(): CommandRegistry | null {
    return (this.app as unknown as { commands?: CommandRegistry }).commands ?? null;
  }

  /** Locate the TaskNotes command by its stable user-facing purpose, not a private implementation ID. */
  private taskNotesCalendarSyncCommand(): RegisteredCommand | null {
    const commands = this.commandRegistry()?.commands ?? {};
    return Object.values(commands).find((command) => {
      if (!command.id.startsWith("tasknotes:")) return false;
      const label = `${command.id} ${command.name}`.toLowerCase();
      return /sync.*all.*tasks|all.*tasks.*sync/.test(label);
    }) ?? null;
  }

  private openTasks(tasks: TaskInfo[], completedStatuses: Set<string>): TaskInfo[] {
    return tasks.filter((task) => !task.archived && !task.completed && !completedStatuses.has(task.status ?? ""));
  }

  private calendarSyncNotice(result: CalendarSyncResult): string {
    const taskLabel = `${result.openTasks} open task${result.openTasks === 1 ? "" : "s"}`;
    switch (result.status) {
      case "synced": return `Tasknotes-PM: asked TaskNotes to sync ${taskLabel} with Google Calendar.`;
      case "skipped": return "Tasknotes-PM: Google Calendar sync is disabled in Tasknotes-PM settings.";
      case "busy": return "Tasknotes-PM: A Google Calendar sync is already running.";
      case "unavailable": return `Tasknotes-PM: ${result.detail}`;
      case "failed": return `Tasknotes-PM: Google Calendar sync failed (${result.detail}).`;
      default: return "Tasknotes-PM: Google Calendar sync did not run.";
    }
  }

  refreshProjectCardStyles(): void {
    const cards = document.querySelectorAll<HTMLElement>(".task-card");
    for (const card of cards) this.styleProjectCard(card);
  }

  private async getTaskNotesApi(): Promise<TaskNotesApi | null> {
    const pluginManager = (this.app as typeof this.app & {
      plugins: { getPlugin(id: string): unknown };
    }).plugins;
    const plugin = pluginManager.getPlugin("tasknotes") as TaskNotesPlugin | null;
    const api = plugin?.api;
    if (!api || api.apiVersion !== 1) return null;
    const required = ["tasks.read", "tasks.write", "relationships.read"];
    return required.every((capability) => api.hasCapability(capability)) ? api : null;
  }

  private async createTaskStates(tasks: TaskInfo[], summary: RunSummary, completedStatuses: Set<string>): Promise<Map<string, TaskState>> {
    const states = new Map<string, TaskState>();
    for (const task of tasks) {
      const frontmatter = this.frontmatterFor(task.path);
      const rawDuration = frontmatter[this.settings.durationProperty];
      const duration = this.readDuration(rawDuration);
      if (duration.invalid) summary.invalidDurations.push(task.path);

      const recordedCompletion = this.parseCompletion(frontmatter[this.settings.completionProperty]);
      const dueCompletion = this.parseCompletion(task.due);
      // A changed due date means the user has deliberately replaced a previously
      // calculated value, so the current TaskNotes value becomes authoritative.
      const recordedDateStillMatchesDue = recordedCompletion !== null
        && this.calendarDate(task.due) === this.formatDueDate(recordedCompletion);
      states.set(task.path, {
        durationHours: duration.value,
        completionMs: recordedDateStillMatchesDue ? recordedCompletion : dueCompletion,
        isCompletedOrArchived: Boolean(task.archived || task.completed || completedStatuses.has(task.status ?? "")),
      });
    }
    return states;
  }

  private async loadChildren(api: TaskNotesApi, tasks: TaskInfo[], summary: RunSummary): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    for (const task of tasks) {
      try {
        const children = await api.relationships.subtasks(task.path);
        if (children.length) result.set(task.path, new Set(children.map((child) => child.path)));
      } catch (error) {
        summary.errors.push(`${task.path}: unable to read subtasks (${this.errorMessage(error)})`);
      }
    }
    return result;
  }

  private async loadDependencies(api: TaskNotesApi, tasks: TaskInfo[], summary: RunSummary): Promise<Map<string, ResolvedDependency[]>> {
    const result = new Map<string, ResolvedDependency[]>();
    for (const task of tasks) {
      try {
        result.set(task.path, await api.relationships.dependencies(task.path));
      } catch (error) {
        summary.errors.push(`${task.path}: unable to read dependencies (${this.errorMessage(error)})`);
      }
    }

    for (const predecessor of tasks) {
      try {
        const targets = await api.relationships.blocking(predecessor.path);
        for (const target of targets) {
          const existing = result.get(target.path) ?? [];
          if (!existing.some((dependency) => dependency.path === predecessor.path)) {
            existing.push({
              dependency: { uid: `[[${predecessor.path.replace(/\.md$/i, "")}]]`, reltype: "FINISHTOSTART" },
              task: predecessor,
              path: predecessor.path,
            });
          }
          result.set(target.path, existing);
        }
      } catch (error) {
        summary.errors.push(`${predecessor.path}: unable to read blocking tasks (${this.errorMessage(error)})`);
      }
    }
    return result;
  }

  private async writeDurationDefaults(states: Map<string, TaskState>, summary: RunSummary): Promise<void> {
    for (const [path] of states) {
      const frontmatter = this.frontmatterFor(path);
      const durationMissing = frontmatter[this.settings.durationProperty] === undefined || frontmatter[this.settings.durationProperty] === null || frontmatter[this.settings.durationProperty] === "";
      if (!durationMissing) continue;

      try {
        await this.app.fileManager.processFrontMatter(this.fileFor(path), (frontmatter) => {
          const metadata = frontmatter as Record<string, unknown>;
          if (durationMissing) metadata[this.settings.durationProperty] = this.settings.defaultDurationHours;
        });
        if (durationMissing) summary.defaultsAdded++;
      } catch (error) {
        summary.errors.push(`${path}: unable to update project metadata (${this.errorMessage(error)})`);
      }
    }
  }

  /**
   * A color belongs to a project group, rather than to a particular rendered
   * card. Saving the hue in frontmatter makes it part of the vault, so a
   * synced device renders the same project without relying on local settings.
   *
   * A project card uses its own hue and each direct child uses that same hue.
   * A nested project therefore starts a new, clearly identifiable group for
   * its own children while still remaining a child of its outer project.
   */
  private async syncProjectColors(
    tasks: TaskInfo[],
    childrenByParent: Map<string, Set<string>>,
    summary: RunSummary,
  ): Promise<void> {
    const parentsByChild = new Map<string, string[]>();
    for (const [parentPath, childPaths] of childrenByParent) {
      for (const childPath of childPaths) {
        const parents = parentsByChild.get(childPath) ?? [];
        parents.push(parentPath);
        parentsByChild.set(childPath, parents);
      }
    }

    const projectPaths = [...childrenByParent.keys()];
    const projectHues = this.settings.projectColorSchemeVersion < DISTINCT_COLOR_SCHEME_VERSION
      ? this.rebalancedProjectHues(projectPaths)
      : this.persistedProjectHues(projectPaths);
    const hues = new Map<string, number>();
    for (const task of tasks) {
      if (childrenByParent.has(task.path)) {
        hues.set(task.path, projectHues.get(task.path) as number);
        continue;
      }

      // A single card cannot display two group colors. Multiple parents are
      // unusual; selecting a stable parent keeps every synced device aligned.
      const primaryParent = parentsByChild.get(task.path)?.sort((a, b) => a.localeCompare(b))[0];
      if (primaryParent) hues.set(task.path, projectHues.get(primaryParent) as number);
    }
    this.projectColorHues = hues;

    for (const [path, hue] of hues) {
      const currentHue = this.readProjectHue(this.frontmatterFor(path)[this.settings.projectColorProperty]);
      if (currentHue === hue) continue;
      try {
        await this.app.fileManager.processFrontMatter(this.fileFor(path), (frontmatter) => {
          const metadata = frontmatter as Record<string, unknown>;
          metadata[this.settings.projectColorProperty] = hue;
        });
        summary.colorsAssigned++;
      } catch (error) {
        summary.errors.push(`${path}: unable to save project color (${this.errorMessage(error)})`);
      }
    }

    if (this.settings.projectColorSchemeVersion < DISTINCT_COLOR_SCHEME_VERSION) {
      this.settings.projectColorSchemeVersion = DISTINCT_COLOR_SCHEME_VERSION;
      await this.saveSettings();
    }
  }

  private async ensureParentDependencies(api: TaskNotesApi, childrenByParent: Map<string, Set<string>>, summary: RunSummary): Promise<void> {
    const context = this.context("Synchronize subtask prerequisites");
    for (const [parentPath, childPaths] of childrenByParent) {
      let existing: ResolvedDependency[];
      try {
        existing = await api.relationships.dependencies(parentPath);
      } catch (error) {
        summary.errors.push(`${parentPath}: unable to inspect prerequisites (${this.errorMessage(error)})`);
        continue;
      }

      const existingPaths = new Set(existing.map((dependency) => dependency.path).filter((path): path is string => Boolean(path)));
      for (const childPath of childPaths) {
        if (existingPaths.has(childPath)) continue;
        try {
          await api.tasks.addDependency(parentPath, {
            uid: `[[${childPath.replace(/\.md$/i, "")}]]`,
            reltype: "FINISHTOSTART",
          }, context);
          summary.dependenciesAdded++;
        } catch (error) {
          summary.errors.push(`${parentPath}: unable to add ${childPath} as prerequisite (${this.errorMessage(error)})`);
        }
      }
    }
  }

  private calculateDates(
    states: Map<string, TaskState>,
    childrenByParent: Map<string, Set<string>>,
    dependencies: Map<string, ResolvedDependency[]>,
    summary: RunSummary,
  ): Map<string, number> {
    const result = new Map<string, number>();
    const visiting = new Set<string>();
    const cyclePaths = new Set<string>();
    const stack: string[] = [];

    const visit = (path: string): number | null => {
      const state = states.get(path);
      if (!state) return null;
      if (result.has(path)) return result.get(path) ?? null;
      if (visiting.has(path)) {
        const cycleStart = stack.indexOf(path);
        const cycle = [...stack.slice(cycleStart), path];
        cycle.forEach((cyclePath) => cyclePaths.add(cyclePath));
        summary.cycles.push(cycle);
        return null;
      }

      visiting.add(path);
      stack.push(path);
      const candidates: number[] = [];
      const childPaths = childrenByParent.get(path) ?? new Set<string>();
      for (const childPath of childPaths) {
        const childCompletion = visit(childPath);
        if (childCompletion !== null) candidates.push(childCompletion + this.settings.projectBufferHours * HOUR_MS);
      }

      for (const dependency of dependencies.get(path) ?? []) {
        if (!dependency.path || childPaths.has(dependency.path)) continue;
        if (dependency.dependency.reltype && dependency.dependency.reltype !== "FINISHTOSTART") continue;
        const predecessorCompletion = visit(dependency.path);
        if (predecessorCompletion !== null) {
          candidates.push(predecessorCompletion + (this.settings.dependencyGapHours + state.durationHours) * HOUR_MS);
        }
      }

      stack.pop();
      visiting.delete(path);
      if (cyclePaths.has(path)) return null;

      const desired = candidates.length ? Math.max(...candidates) : null;
      const completion = desired === null
        ? state.completionMs
        : state.completionMs === null ? desired : Math.max(state.completionMs, desired);
      result.set(path, completion ?? NaN);
      if (completion === null && (childPaths.size || (dependencies.get(path)?.length ?? 0) > 0)) summary.unscheduled.push(path);
      return completion;
    };

    for (const path of states.keys()) visit(path);
    for (const path of cyclePaths) result.delete(path);
    return result;
  }

  private async writeCalculatedDates(api: TaskNotesApi, states: Map<string, TaskState>, calculated: Map<string, number>, summary: RunSummary): Promise<void> {
    const context = this.context("Update project dates");
    for (const [path, completionMs] of calculated) {
      const state = states.get(path);
      if (!state || state.isCompletedOrArchived || !Number.isFinite(completionMs)) continue;
      if (state.completionMs !== null && completionMs <= state.completionMs) continue;

      try {
        await api.tasks.setDue(path, this.formatDueDate(completionMs), context);
        await this.app.fileManager.processFrontMatter(this.fileFor(path), (frontmatter) => {
          const metadata = frontmatter as Record<string, unknown>;
          metadata[this.settings.completionProperty] = new Date(completionMs).toISOString();
        });
        summary.datesChanged++;
      } catch (error) {
        summary.errors.push(`${path}: unable to set due date (${this.errorMessage(error)})`);
      }
    }
  }

  private frontmatterFor(path: string): Record<string, unknown> {
    return this.app.metadataCache.getFileCache(this.fileFor(path))?.frontmatter ?? {};
  }

  private fileFor(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error("Task file is no longer available");
    return file;
  }

  private readDuration(value: unknown): { value: number; invalid: boolean } {
    if (value === undefined || value === null || value === "") return { value: this.settings.defaultDurationHours, invalid: false };
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0
      ? { value: parsed, invalid: false }
      : { value: this.settings.defaultDurationHours, invalid: true };
  }

  private readProjectHue(value: unknown): number | null {
    const hue = typeof value === "number" ? value : Number(value);
    return Number.isInteger(hue) && hue >= 0 && hue < 360 ? hue : null;
  }

  private projectHash(projectPath: string): number {
    let hash = 5381;
    for (let index = 0; index < projectPath.length; index++) {
      hash = ((hash << 5) + hash + projectPath.charCodeAt(index)) >>> 0;
    }
    return hash;
  }

  /**
   * Give the current project set evenly-spaced hues, while interleaving the
   * path-hash order. Consecutive paths therefore receive distant colors
   * instead of adjacent shades such as purple and magenta.
   */
  private rebalancedProjectHues(projectPaths: string[]): Map<string, number> {
    const paths = [...projectPaths].sort((left, right) => {
      const difference = this.projectHash(left) - this.projectHash(right);
      return difference || left.localeCompare(right);
    });
    const hues = new Map<string, number>();
    const count = paths.length;
    if (!count) return hues;

    let paletteIndex = 0;
    const step = this.coprimePaletteStep(count);
    for (const path of paths) {
      hues.set(path, Math.round((paletteIndex * 360) / count) % 360);
      paletteIndex = (paletteIndex + step) % count;
    }
    return hues;
  }

  /** Keep already-persisted project colors stable; only allocate a new one when needed. */
  private persistedProjectHues(projectPaths: string[]): Map<string, number> {
    const hues = new Map<string, number>();
    for (const path of projectPaths) {
      const existing = this.readProjectHue(this.frontmatterFor(path)[this.settings.projectColorProperty]);
      if (existing !== null) hues.set(path, existing);
    }
    for (const path of projectPaths.filter((candidate) => !hues.has(candidate))) {
      hues.set(path, this.farthestAvailableHue(path, [...hues.values()]));
    }
    return hues;
  }

  private farthestAvailableHue(projectPath: string, usedHues: number[]): number {
    const preferred = this.projectHash(projectPath) % 360;
    const candidates = Array.from({ length: 18 }, (_, index) => index * 20);
    return candidates.sort((left, right) => {
      const rightSeparation = this.minimumHueSeparation(right, usedHues);
      const leftSeparation = this.minimumHueSeparation(left, usedHues);
      if (rightSeparation !== leftSeparation) return rightSeparation - leftSeparation;
      return this.circularHueDistance(left, preferred) - this.circularHueDistance(right, preferred);
    })[0];
  }

  private minimumHueSeparation(hue: number, otherHues: number[]): number {
    return otherHues.length ? Math.min(...otherHues.map((other) => this.circularHueDistance(hue, other))) : 360;
  }

  private circularHueDistance(left: number, right: number): number {
    const distance = Math.abs(left - right);
    return Math.min(distance, 360 - distance);
  }

  private coprimePaletteStep(count: number): number {
    for (let step = Math.max(1, Math.floor(count / 2)); step > 0; step--) {
      if (this.greatestCommonDivisor(step, count) === 1) return step;
    }
    return 1;
  }

  private greatestCommonDivisor(left: number, right: number): number {
    let a = left;
    let b = right;
    while (b) [a, b] = [b, a % b];
    return a;
  }

  private parseCompletion(value: unknown): number | null {
    if (typeof value !== "string" || !value.trim()) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const parsed = dateOnly ? new Date(`${value}T23:59:59.999`) : new Date(value);
    const timestamp = parsed.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private formatDueDate(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private calendarDate(value: string | null | undefined): string | null {
    if (!value) return null;
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    return match?.[0] ?? null;
  }

  private context(reason: string): MutationContext {
    return { source: PLUGIN_SOURCE, correlationId: crypto.randomUUID(), reason };
  }

  private completedStatuses(api: TaskNotesApi): Set<string> {
    const statuses = api.catalog?.statuses() ?? [];
    return new Set(statuses
      .filter((status) => status.isCompleted === true || status.completed === true)
      .map((status) => status.value ?? status.id ?? status.name)
      .filter((value): value is string => Boolean(value)));
  }

  private installKanbanObserver(): void {
    this.cardObserver = new MutationObserver((mutations) => {
      if (!this.settings.highlightProjectCards) return;
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!node.instanceOf(HTMLElement)) return;
          if (node.matches(".task-card")) this.styleProjectCard(node);
          node.querySelectorAll?.<HTMLElement>(".task-card").forEach((card) => this.styleProjectCard(card));
        });
      }
    });
    this.cardObserver.observe(document.body, { childList: true, subtree: true });
  }

  private styleProjectCard(card: HTMLElement): void {
    if (!this.settings.highlightProjectCards || !this.isInsideKanban(card)) {
      card.removeClass("tasknotes-pm-project-card");
      card.style.removeProperty("--tasknotes-pm-project-hue");
      return;
    }
    const path = this.pathForCard(card);
    const hue = path ? this.projectColorHues.get(path) : undefined;
    card.toggleClass("tasknotes-pm-project-card", hue !== undefined);
    if (hue === undefined) {
      card.style.removeProperty("--tasknotes-pm-project-hue");
    } else {
      card.style.setProperty("--tasknotes-pm-project-hue", String(hue));
    }
  }

  private isInsideKanban(card: HTMLElement): boolean {
    for (let element: HTMLElement | null = card; element; element = element.parentElement) {
      if (typeof element.className === "string" && /kanban/i.test(element.className)) return true;
      if (element.getAttribute("data-view-type") === "tasknotesKanban") return true;
    }
    return false;
  }

  private pathForCard(card: HTMLElement): string | null {
    const direct = card.getAttribute("data-path") ?? card.getAttribute("data-file-path");
    if (direct) return direct;

    // TaskNotes cards expose their own note name in card metadata. Prefer it to
    // a wikilink in the card: the latter can point at a parent project and would
    // incorrectly colour an ordinary child task as a project.
    // TaskNotes may render "file" and "name" on separate lines in narrow cards.
    const fileName = card.textContent?.match(/file\s*name:\s*(.+?\.md)(?:\s|$)/i)?.[1];
    if (fileName) return this.app.metadataCache.getFirstLinkpathDest(fileName, "")?.path ?? null;

    const link = card.querySelector<HTMLElement>("[data-href], a.internal-link");
    const href = link?.getAttribute("data-href") ?? link?.getAttribute("href");
    if (!href) return null;
    return this.app.metadataCache.getFirstLinkpathDest(href, "")?.path ?? null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
