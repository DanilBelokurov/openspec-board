import type { Stage } from "./openspec";
import type { StageMeta } from "./types";

export const STAGES_ORDER: Stage[] = [
  "backlog",
  "decomposition",
  "plan",
  "develop",
  "tests",
  "deploy",
  "done",
];

export const STAGE_META: Record<Stage, StageMeta> = {
  backlog: { label: "Бэклог", icon: "Inbox" },
  decomposition: { label: "Декомпозиция", icon: "GitBranch" },
  plan: { label: "План", icon: "ClipboardList" },
  develop: { label: "Разработка", icon: "Code2" },
  tests: { label: "Тесты", icon: "TestTube2" },
  deploy: { label: "Деплой", icon: "Rocket" },
  done: { label: "Готово", icon: "CheckCircle2" },
};