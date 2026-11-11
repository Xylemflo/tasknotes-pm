import { App, PluginSettingTab, Setting } from "obsidian";
import type TasknotesPmPlugin from "./main";

export interface TasknotesPmSettings {
  durationProperty: string;
  completionProperty: string;
  projectColorProperty: string;
  /** Internal migration marker for the persisted distinct-project palette. */
  projectColorSchemeVersion: number;
  defaultDurationHours: number;
  dependencyGapHours: number;
  projectBufferHours: number;
  updateOnStartup: boolean;
  syncGoogleCalendarOnStartup: boolean;
  syncGoogleCalendarOnUpdate: boolean;
  highlightProjectCards: boolean;
}

export const DEFAULT_SETTINGS: TasknotesPmSettings = {
  durationProperty: "duration",
  completionProperty: "tasknotesPmCompletion",
  projectColorProperty: "tasknotesPmProjectColor",
  projectColorSchemeVersion: 0,
  defaultDurationHours: 24,
  dependencyGapHours: 24,
  projectBufferHours: 24,
  updateOnStartup: true,
  syncGoogleCalendarOnStartup: true,
  syncGoogleCalendarOnUpdate: true,
  highlightProjectCards: true,
};

export class TasknotesPmSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TasknotesPmPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Tasknotes-PM")
      .setHeading()
      .setDesc("Dates only move later. Calculated timestamps preserve hour-level scheduling while TaskNotes displays a due date.");

    this.addTextSetting(containerEl, "Duration property", "Frontmatter property measured in hours.", "durationProperty");
    this.addTextSetting(containerEl, "Completion timestamp property", "Plugin-owned ISO timestamp used to retain hour-level precision.", "completionProperty");
    this.addTextSetting(containerEl, "Project color property", "A persisted HSL hue (0–359) shared by each project and its direct children.", "projectColorProperty");
    this.addNumberSetting(containerEl, "Default duration", "Hours used when no valid duration exists.", "defaultDurationHours");
    this.addNumberSetting(containerEl, "Dependency gap", "Hours between a predecessor finishing and a successor starting.", "dependencyGapHours");
    this.addNumberSetting(containerEl, "Project buffer", "Hours after the latest subtask before a project completes.", "projectBufferHours");

    new Setting(containerEl)
      .setName("Update project dates on startup")
      .setDesc("Run one safe, extend-only project-date update after TaskNotes is ready.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.updateOnStartup).onChange(async (value) => {
        this.plugin.settings.updateOnStartup = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Sync Google Calendar on startup")
      .setDesc("After TaskNotes is ready, run its built-in Sync all tasks action. TaskNotes decides which dated, open tasks are eligible for export.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.syncGoogleCalendarOnStartup).onChange(async (value) => {
        this.plugin.settings.syncGoogleCalendarOnStartup = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Sync Google Calendar after project updates")
      .setDesc("After the Update Project Dates command finishes, run TaskNotes' built-in Sync all tasks action.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.syncGoogleCalendarOnUpdate).onChange(async (value) => {
        this.plugin.settings.syncGoogleCalendarOnUpdate = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Highlight project cards")
      .setDesc("Use each project's persisted, high-contrast color for the project and its direct child cards in TaskNotes Kanban views.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.highlightProjectCards).onChange(async (value) => {
        this.plugin.settings.highlightProjectCards = value;
        await this.plugin.saveSettings();
        this.plugin.refreshProjectCardStyles();
      }));
  }

  private addTextSetting(containerEl: HTMLElement, name: string, desc: string, key: "durationProperty" | "completionProperty" | "projectColorProperty"): void {
    new Setting(containerEl).setName(name).setDesc(desc).addText((text) => text
      .setValue(this.plugin.settings[key])
      .onChange(async (value) => {
        const normalized = value.trim();
        if (!normalized) return;
        this.plugin.settings[key] = normalized;
        await this.plugin.saveSettings();
      }));
  }

  private addNumberSetting(containerEl: HTMLElement, name: string, desc: string, key: "defaultDurationHours" | "dependencyGapHours" | "projectBufferHours"): void {
    new Setting(containerEl).setName(name).setDesc(desc).addText((text) => text
      .setPlaceholder("24")
      .setValue(String(this.plugin.settings[key]))
      .onChange(async (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        this.plugin.settings[key] = parsed;
        await this.plugin.saveSettings();
      }));
  }
}
