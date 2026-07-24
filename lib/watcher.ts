/**
 * Background watcher — polls every POLL_MS and:
 *
 *   - triggers /opsx-continue for any proposal-stage task ready
 *     for it (via triggerContinueIfNeeded)
 *   - flips buildExitCode on any repo whose code-review-graph
 *     build process has just died, and chains a `visualize` step
 *     on top of a successful build
 *   - flips visualizeExitCode once the visualize step dies
 *
 * Runs only on the server (module-level setInterval is started
 * when this file is first imported from server-side code).
 * Imported for side-effect from app/page.tsx so Next.js dev server
 * starts it automatically after the first request.
 */

import { isProcessAlive } from "./process";
import { readConfig, updateRepoEntry } from "./config";
import { readState, updateTask, mergeDeveloperScan } from "./state";
import { triggerContinueIfNeeded } from "./continuation";
import {
  buildLogPath,
  spawnCodeReviewGraphVisualize,
} from "./code-review-graph";

const POLL_MS = 5000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let started = false;
let lastDeveloperScanAt = 0;

async function tick(): Promise<void> {
  try {
    const config = await readConfig();
    if (!config.openspecDir) return;

    // Stage 0: developer-mode backlog scan. Runs on its own
    // cadence (config.developerScanIntervalMinutes, default 0
    // = off) so the board auto-populates when new change-
    // proposals get merged into the tracked branch. The scan
    // itself is also reachable via POST /api/refresh.
    if (
      config.mode === "developer" &&
      (config.developerScanIntervalMinutes ?? 0) > 0
    ) {
      const intervalMs =
        (config.developerScanIntervalMinutes ?? 0) * 60 * 1000;
      if (Date.now() - lastDeveloperScanAt >= intervalMs) {
        lastDeveloperScanAt = Date.now();
        try {
          await mergeDeveloperScan(
            config.openspecDir,
            config.defaultBranch || "master",
          );
        } catch (e) {
          console.warn("[watcher] developer scan failed:", e);
        }
      }
    }

    // Stage 1: proposal / delta-spec auto-trigger.
    await triggerContinueIfNeeded(config.openspecDir);

    // Stage 2: code-review-graph pipeline progress. For every
    // repo we look at the build and visualize PIDs in order:
    //
    //   build alive, exit unset  → still running, skip
    //   build dead, exit unset   → mark build done (exit 0) and
    //                              chain a visualize step on top of
    //                              the freshly-built data
    //   visualize alive          → still running, skip
    //   visualize dead, exit unset → mark visualize done
    //
    // The graph is considered "built" only when visualizeExitCode
    // === 0; the UI's toast logic uses both signals.
    const repos = config.repos ?? {};
    for (const [name, repo] of Object.entries(repos)) {
      const buildPid = repo.buildPid;
      if (
        buildPid != null &&
        repo.buildExitCode == null &&
        !isProcessAlive(buildPid)
      ) {
        // Build finished. We don't have the real exit code — the
        // spawner only captured stdout/stderr to the log file.
        // isProcessAlive returning false implies the process
        // exited; surface that as exitCode 0 so the visualize
        // step is chained. The user can read the log to see if
        // anything actually failed.
        await updateRepoEntry(name, {
          buildExitCode: 0,
          buildExitSignal: null,
        });
        // Re-read so the visualize check below sees the updated
        // buildExitCode.
        repo.buildExitCode = 0;
      }

      // Chain the visualize step after a successful build.
      if (
        repo.buildExitCode === 0 &&
        repo.visualizePid == null &&
        !isProcessAlive(buildPid ?? -1)
      ) {
        const spawned = await spawnCodeReviewGraphVisualize(name);
        if (spawned.pid != null) {
          await updateRepoEntry(name, {
            visualizePid: spawned.pid,
            visualizeStartedAt: new Date().toISOString(),
            visualizeLogPath: spawned.logFile || buildLogPath(name),
          });
        }
        continue;
      }

      const visualizePid = repo.visualizePid;
      if (
        visualizePid != null &&
        repo.visualizeExitCode == null &&
        !isProcessAlive(visualizePid)
      ) {
        await updateRepoEntry(name, {
          visualizeExitCode: 0,
          visualizeExitSignal: null,
        });
      }
    }

    // Stage 3: per-task push + pull-request liveness. We don't
    // watch every TaskEntry (the tick is shared with the repo
    // pass), so we read state again to avoid the earlier repos
    // loop. The push process is short-lived, so this loop is
    // mostly waiting for the gigacode PR run to settle.
    const stateForTasks = await readState();
    for (const [tag, task] of Object.entries(stateForTasks.tasks)) {
      // Index refresh: when the openspec-store code-review-graph
      // build gigacode finishes, flip its exit code so
      // triggerContinueIfNeeded can chain openspec-new-change on
      // the next watcher tick.
      if (
        task.indexRefreshPid != null &&
        task.indexRefreshExitCode == null &&
        !isProcessAlive(task.indexRefreshPid)
      ) {
        await updateTask(tag, {
          indexRefreshExitCode: 0,
          indexRefreshExitSignal: null,
        });
      }
      if (task.stage !== "done") continue;
      if (task.mode !== "analyst") continue;
      // Push: flip exit code once the detached `git push` process
      // is gone and we haven't recorded its result yet.
      if (
        task.pushPid != null &&
        task.pushExitCode == null &&
        !isProcessAlive(task.pushPid)
      ) {
        await updateTask(tag, {
          pushExitCode: 0,
          pushExitSignal: null,
        });
      }
      // Pull request: same for the gigacode --prompt run.
      if (
        task.pullRequestPid != null &&
        task.pullRequestExitCode == null &&
        !isProcessAlive(task.pullRequestPid)
      ) {
        await updateTask(tag, {
          pullRequestExitCode: 0,
          pullRequestExitSignal: null,
        });
      }
    }
  } catch (e) {
    console.error("[watcher] tick failed:", e);
  }
}

function startWatcher(): void {
  if (started) return;
  started = true;
  // eslint-disable-next-line no-console
  console.log(`[watcher] polling every ${POLL_MS}ms`);
  // tick immediately, then on interval
  void tick();
  intervalHandle = setInterval(() => {
    void tick();
  }, POLL_MS);
}

function stopWatcher(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  started = false;
}

// Auto-start on first server-side import
if (typeof window === "undefined") {
  startWatcher();
}

// Best-effort cleanup on process exit (mainly for tests / hot reload)
if (typeof process !== "undefined" && process.on) {
  process.on("beforeExit", () => stopWatcher());
}

export {};