import fs from "fs/promises";
import path from "path";
import { readState, updateTask } from "./state";
import {
  ensureLogDir,
  processLogPath,
  spawnGigacodeWithLog,
} from "./process-logger";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * For each task in stage="proposal" whose gigacode /opsx-new has finished
 * (we just check that .openspec.yaml exists but proposal.md doesn't yet),
 * spawn gigacode /opsx-continue with stdout/stderr piped to a log file,
 * and record its pid + exit code/signal back to state.
 *
 * Safe to call on every render (and from a background watcher):
 * gigacodeContinuePid flag makes it idempotent.
 *
 * Returns the list of changeNames for which continue was spawned.
 */
export async function triggerContinueIfNeeded(
  openspecDir: string,
): Promise<string[]> {
  const state = await readState();
  const triggered: string[] = [];
  const now = new Date().toISOString();
  await ensureLogDir();

  for (const [changeName, task] of Object.entries(state.tasks)) {
    if (task.stage !== "proposal") continue;
    if (task.gigacodeContinuePid) continue; // already spawned

    const changePath = path.join(openspecDir, "changes", changeName);
    if (!(await exists(changePath))) continue;
    if (!(await exists(path.join(changePath, ".openspec.yaml")))) continue;
    if (await exists(path.join(changePath, "proposal.md"))) continue;

    const logFile = processLogPath(changeName, "continue");
    let pid: number | null = null;
    try {
      const result = spawnGigacodeWithLog({
        argv: ["-p", `/opsx-continue ${changePath}`],
        logFile,
        header: `gigacode /opsx-continue for ${changeName}`,
        addDir: openspecDir,
        approvalMode: "auto-edit",
      });
      pid = result.pid || null;
      result.promise
        .then(async ({ exitCode, signal }) => {
          await updateTask(changeName, {
            gigacodeContinueExitCode: exitCode,
            gigacodeContinueExitSignal: signal,
          });
        })
        .catch((e) =>
          console.error(`gigacode-continue exit handler error:`, e),
        );
    } catch (e) {
      console.error(
        `gigacode /opsx-continue spawn threw for ${changeName}:`,
        e,
      );
    }

    if (pid != null) {
      await updateTask(changeName, {
        gigacodeContinuePid: pid,
        gigacodeContinueStartedAt: now,
        gigacodeContinueLogPath: logFile,
      });
      triggered.push(changeName);
    } else {
      console.error(
        `Failed to spawn gigacode /opsx-continue for ${changeName}`,
      );
    }
  }
  return triggered;
}