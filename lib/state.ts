import fs from "fs/promises";
import path from "path";
import type { ChangeSummary, Stage } from "./openspec";

const STATE_DIR = path.join(process.cwd(), ".sdd-board");
const STATE_FILE = path.join(STATE_DIR, "state.json");

export interface TaskEntry {
  id: string;
  stage: Stage;
  lastScannedAt: string;
  summary: ChangeSummary;
}

export interface AppState {
  tasks: Record<string, TaskEntry>;
}

const EMPTY_STATE: AppState = { tasks: {} };

export async function readState(): Promise<AppState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      tasks: parsed.tasks ?? {},
    };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return EMPTY_STATE;
    throw e;
  }
}

export async function writeState(state: AppState): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(
    STATE_FILE,
    JSON.stringify(state, null, 2) + "\n",
    "utf-8",
  );
}

function nextTaskId(existing: Map<string, TaskEntry>): string {
  let max = 0;
  for (const entry of existing.values()) {
    const n = Number.parseInt(entry.id.replace(/^OS-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `OS-${String(max + 1).padStart(3, "0")}`;
}

export async function mergeScanWithState(
  summaries: ChangeSummary[],
): Promise<AppState> {
  const state = await readState();
  const tasks = new Map<string, TaskEntry>(Object.entries(state.tasks));
  const now = new Date().toISOString();

  for (const summary of summaries) {
    const prev = tasks.get(summary.changeName);
    if (prev) {
      tasks.set(summary.changeName, {
        id: prev.id,
        stage: prev.stage,
        lastScannedAt: now,
        summary: { ...summary, id: prev.id, stage: prev.stage },
      });
    } else {
      const id = nextTaskId(tasks);
      tasks.set(summary.changeName, {
        id,
        stage: "backlog",
        lastScannedAt: now,
        summary: { ...summary, id, stage: "backlog" },
      });
    }
  }

  const merged: AppState = { tasks: Object.fromEntries(tasks) };
  await writeState(merged);
  return merged;
}