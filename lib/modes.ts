import {
  Inbox,
  ClipboardList,
  Code2,
  Rocket,
  CheckCircle2,
  FilePlus,
  FileText,
  Layers,
  BookMarked,
  type LucideIcon,
} from "lucide-react";
import type { Stage } from "./openspec";

export interface StageMeta {
  label: string;
  icon: LucideIcon;
}

export interface BoardMode {
  id: BoardModeId;
  label: string;
  stages: Stage[];
  meta: Record<string, StageMeta>;
}

export type BoardModeId = "developer" | "analyst";

export const MODES: Record<BoardModeId, BoardMode> = {
  developer: {
    id: "developer",
    label: "Разработчик",
    stages: [
      "backlog",
      "plan",
      "develop",
      "deploy",
      "done",
    ],
    meta: {
      backlog: { label: "Бэклог", icon: Inbox },
      plan: { label: "План", icon: ClipboardList },
      develop: { label: "Разработка", icon: Code2 },
      deploy: { label: "Деплой", icon: Rocket },
      done: { label: "Готово", icon: CheckCircle2 },
    },
  },
  analyst: {
    id: "analyst",
    label: "Аналитик",
    stages: ["proposal", "delta-spec", "design", "adr", "done"],
    meta: {
      proposal: { label: "Proposal", icon: FilePlus },
      "delta-spec": { label: "Дельта-спецификация", icon: FileText },
      design: { label: "Дизайн", icon: Layers },
      adr: { label: "ADR", icon: BookMarked },
      done: { label: "Готово", icon: CheckCircle2 },
    },
  },
};

export const DEFAULT_MODE: BoardModeId = "developer";

export function isBoardModeId(value: unknown): value is BoardModeId {
  return value === "developer" || value === "analyst";
}