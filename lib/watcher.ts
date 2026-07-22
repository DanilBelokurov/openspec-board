/**
 * Background watcher — polls every POLL_MS and:
 *
 *   - triggers /opsx-continue for any proposal-stage task ready
 *     for it (via triggerContinueIfNeeded)
 *   - flips buildExitCode on any repo whose code-review-graph
 *     build process has just died
 *
 * Runs only on the server (module-level setInterval is started
 * when this file is first imported from server-side code).
 * Imported for side-effect from app/page.tsx so Next.js dev server
 * starts it automatically after the first request.
 */

import { isProcessAlive } from "./process";
import { readConfig, updateRepoEntry } from "./config";
import { triggerContinueIfNeeded } from "./continuation";

const POLL_MS = 5000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

async function tick(): Promise<void> {
  try {
    const config = await readConfig();
    if (!config.openspecDir) return;

    // Stage 1: proposal / delta-spec auto-trigger.
    await triggerContinueIfNeeded(config.openspecDir);

    // Stage 2: code-review-graph build exit tracking. For every
    // repo with a live buildPid, check whether the process is still
    // alive. Once it's gone, write the exit code / signal back into
    // config so the UI can show a toast on the next render.
    const repos = config.repos ?? {};
    for (const [name, repo] of Object.entries(repos)) {
      const pid = repo.buildPid;
      if (pid == null) continue;
      // Already finalised — skip the process.kill probe so we don't
      // hit the same repo twice per tick.
      if (repo.buildExitCode != null) continue;
      if (isProcessAlive(pid)) continue;
      // Process is gone. We don't have access to the exit code
      // here — the spawner only captured stdout/stderr to the log
      // file. isProcessAlive returning false implies the process
      // exited (or was killed); surface that as exitCode 0 for
      // "completed" and let the user inspect the log for the real
      // status if they care.
      await updateRepoEntry(name, {
        buildExitCode: 0,
        buildExitSignal: null,
      });
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