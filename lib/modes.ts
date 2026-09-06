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
  /**
   * Openspec stages for `developer` / `analyst` modes. Not used by
   * the `uek-expert` review-board mode — see `reviewColumns` below.
   */
  stages: Stage[];
  meta: Record<string, StageMeta>;
}

/**
 * Columns of the UEK-expert review board. These are *not* openspec
 * stages — they describe the lifecycle of a pull-request the current
 * user has been assigned to review. Pulled out of `BoardMode` so the
 * openspec `Stage` enum stays untouched.
 */
export type UekReviewColumn = "new" | "in-review" | "rejected" | "approved";

export interface UekReviewColumnMeta {
  label: string;
  description: string;
}

export const UEK_REVIEW_COLUMNS: Record<UekReviewColumn, UekReviewColumnMeta> = {
  new: {
    label: "Новые",
    description:
      "ПР, в которых текущий пользователь назначен ревьювером и ревью ещё не начато",
  },
  "in-review": {
    label: "В процессе",
    description: "Ревью уже начато, но вердикт ещё не выставлен",
  },
  rejected: {
    label: "Отклонено",
    description: "Ревью завершено с решением «отклонить»",
  },
  approved: {
    label: "Согласовано",
    description: "Ревью завершено с решением «согласовать»",
  },
};

export type BoardModeId = "developer" | "analyst" | "uek-expert";

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
  "uek-expert": {
    id: "uek-expert",
    label: "Эксперт УЭК",
    // The UEK-expert mode renders its own review columns from
    // `UEK_REVIEW_COLUMNS`, so the openspec stage list is empty.
    stages: [],
    meta: {},
  },
};

export const DEFAULT_MODE: BoardModeId = "developer";

export function isBoardModeId(value: unknown): value is BoardModeId {
  return (
    value === "developer" || value === "analyst" || value === "uek-expert"
  );
}