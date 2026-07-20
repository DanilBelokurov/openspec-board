export type Stage =
  | "backlog"
  | "decomposition"
  | "plan"
  | "develop"
  | "tests"
  | "deploy"
  | "done";

export type Priority = "low" | "medium" | "high" | "urgent";

export interface Label {
  name: string;
  color: string;
}

export interface Assignee {
  name: string;
  initials: string;
  color: string;
}

export interface TaskProgress {
  done: number;
  total: number;
}

export interface Session {
  id: string;
  title: string;
  changeName: string;
  stage: Stage;
  priority: Priority;
  labels: Label[];
  assignee: Assignee;
  createdAt: string;
  comments: number;
  tasksProgress: TaskProgress;
}

export interface StageMeta {
  label: string;
  icon: string;
}