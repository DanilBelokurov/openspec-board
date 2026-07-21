import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { readState, updateTask } from "./state";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function spawnContinueQwen(changePath: string): number | null {
  try {
    const child = spawn("qwen", ["-p", `/opsx-continue ${changePath}`], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (err) => {
      console.error(
        `qwen -p /opsx-continue spawn error for ${changePath}:`,
        err.message,
      );
    });
    child.unref();
    return child.pid ?? null;
  } catch (e) {
    console.error(`qwen -p /opsx-continue spawn threw for ${changePath}:`, e);
    return null;
  }
}

/**
 * For each task in stage="proposal" whose qwen /opsx-new has finished
 * (we just check that .openspec.yaml exists but proposal.md doesn't yet),
 * spawn qwen /opsx-continue and record its pid.
 *
 * Safe to call on every render: qwenContinuePid flag makes it idempotent.
 *
 * Returns the list of changeNames for which continue was spawned.
 */
export async function triggerContinueIfNeeded(
  openspecDir: string,
): Promise<string[]> {
  const state = await readState();
  const triggered: string[] = [];
  const now = new Date().toISOString();

  for (const [changeName, task] of Object.entries(state.tasks)) {
    if (task.stage !== "proposal") continue;
    if (task.qwenContinuePid) continue; // already spawned

    const changePath = path.join(openspecDir, "changes", changeName);
    if (!(await exists(changePath))) continue;
    if (!(await exists(path.join(changePath, ".openspec.yaml")))) continue;
    if (await exists(path.join(changePath, "proposal.md"))) continue;

    const pid = spawnContinueQwen(changePath);
    if (pid != null) {
      await updateTask(changeName, {
        qwenContinuePid: pid,
        qwenContinueStartedAt: now,
      });
      triggered.push(changeName);
    } else {
      console.error(
        `Failed to spawn qwen /opsx-continue for ${changeName}`,
      );
    }
  }
  return triggered;
}