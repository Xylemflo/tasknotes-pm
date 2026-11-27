import { App, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinition, SettingDefinitionItem } from "obsidian";
import type TasknotesPmPlugin from "./main";

export interface TasknotesPmSettings {
  durationProperty: string;
  completionProperty: string;
  hardDeadlineProperty: string;
  projectColorProperty: string;
  /** Internal migration marker for the persisted distinct-project palette. */
  projectColorSchemeVersion: number;
  defaultDurationHours: number;
  dependencyGapHours: number;
  projectBufferHours: number;
  hardDeadlineConflictPolicy: "ignore" | "move-deadline";
  updateOnStartup: boolean;
  syncGoogleCalendarOnStartup: boolean;
  syncGoogleCalendarOnUpdate: boolean;
  highlightProjectCards: boolean;
}

export const DEFAULT_SETTINGS: TasknotesPmSettings = {
  durationProperty: "duration",
  completionProperty: "tasknotesPmCompletion",
  hardDeadlineProperty: "hardDeadline",
  projectColorProperty: "tasknotesPmProjectColor",
  projectColorSchemeVersion: 0,
  defaultDurationHours: 24,
  dependencyGapHours: 24,
  projectBufferHours: 24,
  hardDeadlineConflictPolicy: "ignore",
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
      .setName("Project scheduling")
      .setHeading()
      .setDesc("Ordinary dependencies extend dates; project rollups and hard deadlines are exact. Precise timestamps are retained while TaskNotes displays a date.");

    this.addTextSetting(containerEl, "Duration property", "Frontmatter property measured in hours.", "durationProperty");
    this.addTextSetting(containerEl, "Completion timestamp property", "Plugin-owned ISO timestamp used to retain hour-level precision.", "completionProperty");
    this.addTextSetting(containerEl, "Hard deadline property", "A date in this frontmatter property schedules children backward from the parent deadline.", "hardDeadlineProperty");
    this.addTextSetting(containerEl, "Project color property", "A persisted hex color shared by each project and its direct children.", "projectColorProperty");
    this.addNumberSetting(containerEl, "Default duration", "Hours used when no valid duration exists.", "defaultDurationHours");
    this.addNumberSetting(containerEl, "Dependency gap", "Hours between a predecessor finishing and a successor starting.", "dependencyGapHours");

    new Setting(containerEl)
      .setName("Hard deadline conflict")
      .setDesc("Choose what happens when backward scheduling would begin before today.")
      .addDropdown((dropdown) => dropdown
        .addOption("ignore", "Honor deadline and create overdue tasks")
        .addOption("move-deadline", "Move parent due date and deadline")
        .setValue(this.plugin.settings.hardDeadlineConflictPolicy)
        .onChange(async (value) => {
          this.plugin.settings.hardDeadlineConflictPolicy = value as TasknotesPmSettings["hardDeadlineConflictPolicy"];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Update project dates on startup")
      .setDesc("Run the same project rollup and deadline update after TaskNotes is ready.")
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

  /**
   * Makes these settings searchable in Obsidian 1.13 and later. The
   * imperative display() implementation above remains as the compatibility
   * fallback for Obsidian 1.12.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: "group",
      heading: "Project scheduling",
      items: [
        this.textDefinition("durationProperty", "Duration property", "Frontmatter property measured in hours."),
        this.textDefinition("completionProperty", "Completion timestamp property", "Plugin-owned ISO timestamp used to retain hour-level precision."),
        this.textDefinition("hardDeadlineProperty", "Hard deadline property", "A date in this frontmatter property schedules children backward from the parent deadline."),
        this.textDefinition("projectColorProperty", "Project color property", "A persisted hex color shared by each project and its direct children."),
        this.numberDefinition("defaultDurationHours", "Default duration", "Hours used when no valid duration exists."),
        this.numberDefinition("dependencyGapHours", "Dependency gap", "Hours between a predecessor finishing and a successor starting."),
        {
          name: "Hard deadline conflict",
          desc: "Choose what happens when backward scheduling would begin before today.",
          control: {
            type: "dropdown",
            key: "hardDeadlineConflictPolicy",
            options: {
              ignore: "Honor deadline and create overdue tasks",
              "move-deadline": "Move parent due date and deadline",
            },
          },
        },
        {
          name: "Update project dates on startup",
          desc: "Run the same project rollup and deadline update after TaskNotes is ready.",
          control: { type: "toggle", key: "updateOnStartup" },
        },
        {
          name: "Sync Google Calendar on startup",
          desc: "After TaskNotes is ready, run its built-in Sync all tasks action. TaskNotes decides which dated, open tasks are eligible for export.",
          control: { type: "toggle", key: "syncGoogleCalendarOnStartup" },
        },
        {
          name: "Sync Google Calendar after project updates",
          desc: "After the Update Project Dates command finishes, run TaskNotes' built-in Sync all tasks action.",
          control: { type: "toggle", key: "syncGoogleCalendarOnUpdate" },
        },
        {
          name: "Highlight project cards",
          desc: "Use each project's persisted, high-contrast color for the project and its direct child cards in TaskNotes Kanban views.",
          control: { type: "toggle", key: "highlightProjectCards" },
        },
      ],
    }];
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof TasknotesPmSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (!this.isEditableSettingKey(key)) return;
    const current = this.plugin.settings[key];
    if (typeof current === "string" && typeof value !== "string") return;
    if (typeof current === "number" && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) return;
    if (typeof current === "boolean" && typeof value !== "boolean") return;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return;
    const normalized: string | number | boolean = typeof value === "string" ? value.trim() : value;
    if (typeof normalized === "string" && !normalized) return;
    (this.plugin.settings as unknown as Record<string, string | number | boolean>)[key] = normalized;
    await this.plugin.saveSettings();
    if (key === "highlightProjectCards") this.plugin.refreshProjectCardStyles();
  }

  private addTextSetting(containerEl: HTMLElement, name: string, desc: string, key: "durationProperty" | "completionProperty" | "hardDeadlineProperty" | "projectColorProperty"): void {
    new Setting(containerEl).setName(name).setDesc(desc).addText((text) => text
      .setValue(this.plugin.settings[key])
      .onChange(async (value) => {
        const normalized = value.trim();
        if (!normalized) return;
        this.plugin.settings[key] = normalized;
        await this.plugin.saveSettings();
      }));
  }

  private addNumberSetting(containerEl: HTMLElement, name: string, desc: string, key: "defaultDurationHours" | "dependencyGapHours"): void {
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

  private textDefinition(key: "durationProperty" | "completionProperty" | "hardDeadlineProperty" | "projectColorProperty", name: string, desc: string): SettingDefinition {
    return {
      name,
      desc,
      control: {
        type: "text",
        key,
        validate: (value) => value.trim() ? undefined : "A property name is required.",
      },
    };
  }

  private numberDefinition(key: "defaultDurationHours" | "dependencyGapHours", name: string, desc: string): SettingDefinition {
    return {
      name,
      desc,
      control: {
        type: "number",
        key,
        min: 0.000001,
        step: "any",
        placeholder: "24",
      },
    };
  }

  private isEditableSettingKey(key: string): key is "durationProperty" | "completionProperty" | "hardDeadlineProperty" | "projectColorProperty" | "defaultDurationHours" | "dependencyGapHours" | "hardDeadlineConflictPolicy" | "updateOnStartup" | "syncGoogleCalendarOnStartup" | "syncGoogleCalendarOnUpdate" | "highlightProjectCards" {
    return key !== "projectColorSchemeVersion" && key in this.plugin.settings;
  }
}
