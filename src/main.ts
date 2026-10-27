import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, TasknotesPmSettingTab, type TasknotesPmSettings } from "./settings";
import type { MutationContext, ResolvedDependency, TaskInfo, TaskNotesApi, TaskNotesPlugin } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const PLUGIN_SOURCE = "tasknotes-pm";

type TaskState = {
  durationHours: number;
  completionMs: number | null;
  isCompletedOrArchived: boolean;
};

type RunSummary = {
  scanned: number;
  dependenciesAdded: number;
  datesChanged: number;
  defaultsAdded: number;
  invalidDurations: string[];
  unscheduled: string[];
  cycles: string[][];
  errors: string[];
};

export default class TasknotesPmPlugin extends Plugin {
  settings: TasknotesPmSettings = DEFAULT_SETTINGS;
  private updateInProgress = false;
  private projectPaths = new Set<string>();
  private cardObserver: MutationObserver | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new TasknotesPmSettingTab(this.app, this));
    this.addCommand({
      id: "update-project-dates",
      name: "Update Project Dates",
      callback: () => void this.updateProjectDates(false),
    });

    this.installKanbanObserver();
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.updateOnStartup) void this.updateProjectDates(true);
    });
  }

  onunload(): void {
    this.cardObserver?.disconnect();
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
      scanned: 0, dependenciesAdded: 0, datesChanged: 0, defaultsAdded: 0,
      invalidDurations: [], unscheduled: [], cycles: [], errors: [],
    };

    try {
      await api.lifecycle.ready();
      const tasks = await api.tasks.list();
      summary.scanned = tasks.length;
      const states = await this.createTaskStates(tasks, summary, this.completedStatuses(api));
      const childrenByParent = await this.loadChildren(api, tasks, summary);
      this.projectPaths = new Set(childrenByParent.keys());

      await this.writeDurationDefaults(states, summary);
      await this.ensureParentDependencies(api, childrenByParent, summary);

      const dependencies = await this.loadDependencies(api, tasks, summary);
      const calculated = this.calculateDates(states, childrenByParent, dependencies, summary);
      await this.writeCalculatedDates(api, states, calculated, summary);
      this.refreshProjectCardStyles();
    } catch (error) {
      console.error("Tasknotes-PM update failed", error);
      summary.errors.push(this.errorMessage(error));
    } finally {
      this.updateInProgress = false;
    }

    const detail = [
      `${summary.scanned} scanned`,
      `${summary.dependenciesAdded} prerequisite${summary.dependenciesAdded === 1 ? "" : "s"} added`,
      `${summary.datesChanged} date${summary.datesChanged === 1 ? "" : "s"} updated`,
      summary.unscheduled.length ? `${summary.unscheduled.length} unscheduled` : "",
      summary.cycles.length ? `${summary.cycles.length} cycle${summary.cycles.length === 1 ? "" : "s"}` : "",
      summary.errors.length ? `${summary.errors.length} error${summary.errors.length === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(" · ");
    new Notice(`Tasknotes-PM: ${detail}`, 7000);
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
        await this.app.fileManager.processFrontMatter(this.fileFor(path), (fm) => {
          if (durationMissing) fm[this.settings.durationProperty] = this.settings.defaultDurationHours;
        });
        if (durationMissing) summary.defaultsAdded++;
      } catch (error) {
        summary.errors.push(`${path}: unable to update project metadata (${this.errorMessage(error)})`);
      }
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
        await this.app.fileManager.processFrontMatter(this.fileFor(path), (fm) => {
          fm[this.settings.completionProperty] = new Date(completionMs).toISOString();
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
          if (!(node instanceof HTMLElement)) return;
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
      return;
    }
    const path = this.pathForCard(card);
    card.toggleClass("tasknotes-pm-project-card", Boolean(path && this.projectPaths.has(path)));
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
    if (direct && this.projectPaths.has(direct)) return direct;

    // TaskNotes cards expose their own note name in card metadata. Prefer it to
    // a wikilink in the card: the latter can point at a parent project and would
    // incorrectly colour an ordinary child task as a project.
    // TaskNotes may render "file" and "name" on separate lines in narrow cards.
    const fileName = card.textContent?.match(/file\s*name:\s*(.+?\.md)(?:\s|$)/i)?.[1];
    if (fileName) {
      const matches = this.app.vault.getFiles().filter((file) => file.name === fileName);
      if (matches.length === 1) return matches[0].path;
    }

    const link = card.querySelector<HTMLElement>("[data-href], a.internal-link");
    const href = link?.getAttribute("data-href") ?? link?.getAttribute("href");
    if (!href) return null;
    return this.app.metadataCache.getFirstLinkpathDest(href, "")?.path ?? null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
