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
import { triggerContinueIfNeeded } from "./continuation";
import {
  buildLogPath,
  spawnCodeReviewGraphVisualize,
} from "./code-review-graph";

const POLL_MS = 5000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

async function tick(): Promise<void> {
  try {
    const config = await readConfig();
    if (!config.openspecDir) return;

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
        const spawned = await spawnCodeReviewGraphVisualize(
          config.openspecDir,
          name,
        );
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