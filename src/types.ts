import type { EventRef } from "obsidian";

export type MutationContext = {
  source?: string;
  correlationId?: string;
  reason?: string;
};

export type TaskInfo = {
  path: string;
  due?: string | null;
  status?: string;
  archived?: boolean;
  completed?: boolean;
};

export type TaskDependency = {
  uid: string;
  reltype?: "FINISHTOSTART" | "FINISHTOFINISH" | "STARTTOSTART" | "STARTTOFINISH";
  gap?: string;
};

export type ResolvedDependency = {
  dependency: TaskDependency;
  task: TaskInfo | null;
  path: string | null;
};

export interface TaskNotesApi {
  apiVersion: number;
  hasCapability(capability: string): boolean;
  lifecycle: { ready(): Promise<void> };
  tasks: {
    list(): Promise<TaskInfo[]>;
    setDue(path: string, date: string, context?: MutationContext): Promise<TaskInfo>;
    addDependency(path: string, dependency: TaskDependency, context?: MutationContext): Promise<TaskInfo>;
  };
  relationships: {
    subtasks(path: string): Promise<TaskInfo[]>;
    dependencies(path: string): Promise<ResolvedDependency[]>;
    blocking(path: string): Promise<TaskInfo[]>;
  };
  catalog?: { statuses(): Array<{ value?: string; id?: string; name?: string; isCompleted?: boolean; completed?: boolean }> };
  events?: { on(name: string, callback: (event: unknown) => void): EventRef };
}

export type TaskNotesPlugin = { api?: TaskNotesApi };
