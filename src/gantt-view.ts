import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type TasknotesPmPlugin from "./main";
import type { GanttProject, GanttTask } from "./types";

export const GANTT_VIEW_TYPE = "tasknotes-pm-gantt";
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const WEEK_COLUMN_WIDTH = 72;

export class TasknotesPmGanttView extends ItemView {
  private selectedProject = "all";

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TasknotesPmPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return GANTT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Tasknotes-PM Gantt";
  }

  getIcon(): string {
    return "chart-gantt";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const content = this.contentEl;
    content.empty();
    content.addClass("tasknotes-pm-gantt-view");

    const toolbar = content.createDiv({ cls: "tasknotes-pm-gantt-toolbar" });
    toolbar.createEl("h2", { text: "Project timeline" });
    const controls = toolbar.createDiv({ cls: "tasknotes-pm-gantt-controls" });
    const select = controls.createEl("select", { attr: { "aria-label": "Choose project" } });
    const refreshButton = controls.createEl("button", { attr: { "aria-label": "Refresh Gantt chart" } });
    setIcon(refreshButton, "refresh-cw");

    let projects: GanttProject[];
    try {
      projects = await this.plugin.getGanttProjects();
    } catch (error) {
      content.createDiv({ cls: "tasknotes-pm-gantt-empty", text: `Unable to load projects: ${this.plugin.describeError(error)}` });
      return;
    }

    select.createEl("option", { text: "All open projects", value: "all" });
    for (const project of projects) select.createEl("option", { text: project.name, value: project.path });
    if (this.selectedProject !== "all" && !projects.some((project) => project.path === this.selectedProject)) {
      this.selectedProject = "all";
    }
    select.value = this.selectedProject;
    select.addEventListener("change", () => {
      this.selectedProject = select.value;
      this.drawProjects(chart, projects);
    });
    refreshButton.addEventListener("click", () => void this.render());

    const chart = content.createDiv({ cls: "tasknotes-pm-gantt-chart" });
    this.drawProjects(chart, projects);
  }

  private drawProjects(chart: HTMLElement, projects: GanttProject[]): void {
    chart.empty();
    const visible = this.selectedProject === "all"
      ? projects
      : projects.filter((project) => project.path === this.selectedProject);
    if (!visible.length) {
      chart.createDiv({ cls: "tasknotes-pm-gantt-empty", text: "No open projects with scheduled children." });
      return;
    }

    const tasks = visible.flatMap((project) => project.tasks);
    const earliest = Math.min(...tasks.map((task) => task.startMs));
    const latest = Math.max(...tasks.map((task) => task.endMs));
    const min = this.startOfWeek(earliest);
    const weekCount = Math.max(1, Math.ceil((latest - min) / WEEK_MS));
    const range = weekCount * WEEK_MS;
    chart.style.setProperty("--tasknotes-pm-gantt-week-count", String(weekCount));
    chart.style.setProperty("--tasknotes-pm-gantt-timeline-width", `${Math.max(500, weekCount * WEEK_COLUMN_WIDTH)}px`);
    this.drawAxis(chart, min, range, weekCount);

    for (const project of visible) {
      const section = chart.createDiv({ cls: "tasknotes-pm-gantt-project" });
      const heading = section.createDiv({ cls: "tasknotes-pm-gantt-project-heading" });
      const swatch = heading.createSpan({ cls: "tasknotes-pm-gantt-swatch" });
      swatch.style.setProperty("--tasknotes-pm-project-hue", String(project.hue));
      this.createTaskLink(heading, project.path, project.name, "tasknotes-pm-gantt-project-link");
      for (const task of project.tasks) this.drawTask(section, task, min, range);
    }
  }

  private drawAxis(chart: HTMLElement, min: number, range: number, weekCount: number): void {
    const axis = chart.createDiv({ cls: "tasknotes-pm-gantt-axis" });
    axis.createDiv({ cls: "tasknotes-pm-gantt-axis-label", text: "Task" });
    const ticks = axis.createDiv({ cls: "tasknotes-pm-gantt-axis-ticks" });
    for (let index = 0; index <= weekCount; index++) {
      const date = new Date(min + index * WEEK_MS);
      const tick = ticks.createDiv({ cls: "tasknotes-pm-gantt-week-tick" });
      tick.style.left = `${(index / weekCount) * 100}%`;
      const label = tick.createSpan({ text: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
      if (index === weekCount) label.addClass("is-end");
    }
  }

  private drawTask(section: HTMLElement, task: GanttTask, min: number, range: number): void {
    const row = section.createDiv({ cls: "tasknotes-pm-gantt-row" });
    const label = row.createDiv({ cls: "tasknotes-pm-gantt-label" });
    label.style.paddingInlineStart = `${8 + task.depth * 14}px`;
    if (task.isProject) label.addClass("is-project");
    this.createTaskLink(label, task.path, task.name, "tasknotes-pm-gantt-task-link");
    const track = row.createDiv({ cls: "tasknotes-pm-gantt-track" });
    const bar = this.createTaskLink(
      track,
      task.path,
      "",
      `tasknotes-pm-gantt-bar${task.isProject ? " is-project" : ""}`,
    );
    bar.style.left = `${Math.max(0, ((task.startMs - min) / range) * 100)}%`;
    bar.style.width = `${Math.max(0.8, ((task.endMs - task.startMs) / range) * 100)}%`;
    bar.style.setProperty("--tasknotes-pm-project-hue", String(task.hue));
    bar.setAttribute("aria-label", `${task.name}: ${this.dateText(task.startMs)} to ${this.dateText(task.endMs)}`);
    bar.setAttribute("data-tooltip-position", "top");
  }

  private createTaskLink(parent: HTMLElement, path: string, text: string, className: string): HTMLAnchorElement {
    const link = parent.createEl("a", {
      cls: className,
      text,
      attr: { href: path, "data-href": path },
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void this.app.workspace.openLinkText(path, "", event.metaKey || event.ctrlKey);
    });
    return link;
  }

  private startOfWeek(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    const daysSinceMonday = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - daysSinceMonday);
    return date.getTime();
  }

  private dateText(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
}
