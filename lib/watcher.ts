/**
 * Background watcher — polls every POLL_MS and:
 *
 *   - triggers /opsx-continue for any proposal-stage task ready
 *     for it (via triggerContinueIfNeeded)
 *   - flips buildExitCode on any repo whose code-review-graph
 *     build process has just died, and chains a `wiki` step on
 *     top of a successful build
 *   - flips wikiExitCode once the wiki step dies
 *   - periodically scans remote feature branches in analyst mode
 *     so the board picks up proposals published by other users
 *
 * Runs only on the server (module-level setInterval is started
 * when this file is first imported from server-side code).
 * Imported for side-effect from app/page.tsx so Next.js dev server
 * starts it automatically after the first request.
 */

import { isProcessAlive } from "./process";
import { readConfig, updateRepoEntry } from "./config";
import {
  readState,
  updateTask,
  taskKey,
  refreshAnalystTaskSummary,
  mergeDeveloperScan,
  mergeRemoteFeatureScan,
} from "./state";
import { triggerContinueIfNeeded } from "./continuation";
import {
  buildLogPath,
  spawnCodeReviewGraphWiki,
} from "./code-review-graph";

const POLL_MS = 5000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let started = false;
let lastDeveloperScanAt = 0;
/**
 * Timestamp of the last analyst-mode remote feature-branches
 * scan. Tracked separately from the developer scan so the two
 * cadences don't interfere — the user may set 60min for the dev
 * scan and 5min for the remote scan. Default cadence for the
 * remote scan is 5 minutes (see `DEFAULT_REMOTE_SCAN_MINUTES`).
 */
let lastRemoteScanAt = 0;
const DEFAULT_REMOTE_SCAN_MINUTES = 5;
/**
 * Timestamp of the last UEK-expert mode scan. Tracked separately
 * from the developer/analyst scans so the UEK cadence (driven by
 * `config.uekExpertScanIntervalMinutes`, default 5 minutes) doesn't
 * share a clock with the other two.
 */
let lastUekScanAt = 0;
const DEFAULT_UEK_SCAN_MINUTES = 5;

/**
 * Cadence for the lightweight analyst-metadata refresh.
 *
 * Re-reads proposal.md / design.md / specs/ on disk for each
 * LOCAL analyst task and writes back `summary.{title, hasProposal,
 * hasDesign, hasSpecs, fileCount, totalSize, updatedAt}` plus
 * `lastScannedAt`. Remote-analyst tasks are intentionally skipped
 * — they ride along with `mergeRemoteFeatureScan`, which already
 * keeps their summary current from git.
 *
 * Not exposed as a config knob (yet): 30s feels right both as an
 * upper bound on staleness when the user edits proposal.md outside
 * the UI AND as a comfortably low rate for sequential per-task
 * scans on a small board. Raise it only if profiling shows real
 * contention on state.json's atomic write.
 */
const ANALYST_META_REFRESH_MS = 30_000;
let lastAnalystMetaRefreshAt = 0;

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

    // Stage 0.5: analyst-mode remote feature-branches scan.
    //
    // Picks up proposals published by other users on
    // origin/feature/* branches. The cadence defaults to 5
    // minutes when remoteScanIntervalMinutes is unset — the
    // dev-scan defaults to 0 (off) so users aren't surprised
    // by background activity, but the remote scan is the
    // primary "live" UX in analyst mode and a 5-min default
    // is appropriate. Set to 0 to disable entirely; the user
    // can still trigger it via the manual ↻ button.
    //
    // Only fires in analyst mode — in developer mode the
    // task discovery is driven by mergeDeveloperScan above,
    // which looks at the merged defaultBranch (the dev
    // doesn't care about other users' in-flight branches).
    if (config.mode === "analyst") {
      const intervalMinutes =
        config.remoteScanIntervalMinutes ?? DEFAULT_REMOTE_SCAN_MINUTES;
      if (intervalMinutes > 0) {
        const intervalMs = intervalMinutes * 60 * 1000;
        if (Date.now() - lastRemoteScanAt >= intervalMs) {
          lastRemoteScanAt = Date.now();
          try {
            await mergeRemoteFeatureScan(config.openspecDir);
          } catch (e) {
            console.warn("[watcher] remote feature scan failed:", e);
          }
        }
      }
    }

    // Stage 0.55: UEK-expert review board scan.
    //
    // Polls the bitbucket MCP through gigacode (see
    // lib/uek-expert/scanner.ts) on a separate cadence so the
    // review-board load doesn't compete with the openspec-mode
    // scans. Only fires in uek-expert mode; the cadence defaults
    // to 5 minutes and 0 disables auto-scan entirely (the manual
    // "Обновить" button still works).
    if (config.mode === "uek-expert") {
      const intervalMinutes =
        config.uekExpertScanIntervalMinutes ?? DEFAULT_UEK_SCAN_MINUTES;
      if (intervalMinutes > 0) {
        const intervalMs = intervalMinutes * 60 * 1000;
        if (Date.now() - lastUekScanAt >= intervalMs) {
          lastUekScanAt = Date.now();
          try {
            const { scanUekPullRequests } = await import(
              "@/lib/uek-expert/scanner"
            );
            const result = await scanUekPullRequests();
            if (!result.ok) {
              console.warn(
                "[watcher] uek-expert scan failed:",
                result.error,
              );
            }
          } catch (e) {
            console.warn("[watcher] uek-expert scan crashed:", e);
          }
        }
      }
    }

    // Stage 0.6: analyst-mode metadata-only refresh.
    //
    // Re-reads proposal.md / design.md / specs/ for each LOCAL
    // analyst task and updates its summary fields so direct edits
    // outside the UI show up on the board within ~30s without a
    // manual ↻ click. Remote-analyst tasks are excluded because
    // mergeRemoteFeatureScan above already keeps them current.
    //
    // We iterate sequentially rather than Promise.all'ing every
    // task's scanOneRoot — multiple tasks share the same root
    // (the main openspecDir or a single worktree), so parallelism
    // would re-walk the same directory tree N times in parallel.
    // Sequential is also kinder to disk caches; with tens of tasks
    // at most, latency stays well below one tick interval.
    if (
      config.mode === "analyst" &&
      Date.now() - lastAnalystMetaRefreshAt >= ANALYST_META_REFRESH_MS
    ) {
      lastAnalystMetaRefreshAt = Date.now();
      try {
        const metaState = await readState();
        for (const [key, task] of Object.entries(metaState.tasks)) {
          if (task.mode !== "analyst") continue;
          if (task.remote) continue;
          try {
            const patch = await refreshAnalystTaskSummary(
              task,
              config.openspecDir,
            );
            if (!patch) continue;
            // Guard against races where another concurrent write
            // removed the entry between readState() and updateTask().
            // Without this we'd resurrect it under a stale mode-less
            // key, which `parseTaskKey` would then reject.
            if (!metaState.tasks[key]) continue;
            await updateTask(task.mode, task.summary.changeName, patch);
          } catch (e) {
            console.warn(
              `[watcher] meta refresh ${task.summary.changeName} failed:`,
              e,
            );
          }
        }
      } catch (e) {
        console.warn("[watcher] analyst metadata refresh pass failed:", e);
      }
    }

    // Stage 1: proposal / delta-spec auto-trigger.
    await triggerContinueIfNeeded(config.openspecDir);

    // Stage 2: code-review-graph pipeline progress. For every
    // repo we look at the build and wiki PIDs in order:
    //
    //   build alive, exit unset  → still running, skip
    //   build dead, exit unset   → mark build done (exit 0) and
    //                              chain a wiki step on top of
    //                              the freshly-built graph
    //   wiki alive               → still running, skip
    //   wiki dead, exit unset    → mark wiki done
    //
    // The pipeline is considered "wiki done" only when
    // wikiExitCode === 0; the UI's toast logic uses both signals.
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
        // exited; surface that as exitCode 0 so the wiki step is
        // chained. The user can read the log to see if anything
        // actually failed.
        await updateRepoEntry(name, {
          buildExitCode: 0,
          buildExitSignal: null,
        });
        // Re-read so the wiki check below sees the updated
        // buildExitCode.
        repo.buildExitCode = 0;
      }

      // Chain the wiki step after a successful build.
      if (
        repo.buildExitCode === 0 &&
        repo.wikiPid == null &&
        !isProcessAlive(buildPid ?? -1)
      ) {
        const spawned = await spawnCodeReviewGraphWiki(name);
        if (spawned.pid != null) {
          await updateRepoEntry(name, {
            wikiPid: spawned.pid,
            wikiStartedAt: new Date().toISOString(),
            wikiLogPath: spawned.logFile || buildLogPath(name),
          });
        }
        continue;
      }

      const wikiPid = repo.wikiPid;
      if (
        wikiPid != null &&
        repo.wikiExitCode == null &&
        !isProcessAlive(wikiPid)
      ) {
        await updateRepoEntry(name, {
          wikiExitCode: 0,
          wikiExitSignal: null,
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
      if (task.stage !== "done") continue;
      if (task.mode !== "analyst") continue;
      // Push: flip exit code once the detached `git push` process
      // is gone and we haven't recorded its result yet.
      if (
        task.pushPid != null &&
        task.pushExitCode == null &&
        !isProcessAlive(task.pushPid)
      ) {
        await updateTask("analyst", tag, {
          pushExitCode: 0,
          pushExitSignal: null,
          pushedAt: new Date().toISOString(),
        });
      }
      // Pull request: same for the gigacode --prompt run.
      if (
        task.pullRequestPid != null &&
        task.pullRequestExitCode == null &&
        !isProcessAlive(task.pullRequestPid)
      ) {
        await updateTask("analyst", tag, {
          pullRequestExitCode: 0,
          pullRequestExitSignal: null,
        });
      }
      // Sdd label: same self-heal for the gigacode --prompt
      // run that applies the `sdd` label to the linked Jira
      // issue. Marks both the exit code and the applied-at
      // timestamp so deploy-status can flip the UI to
      // `published-with-sdd-label` without a second poll.
      if (
        task.sddLabelPid != null &&
        task.sddLabelExitCode == null &&
        !isProcessAlive(task.sddLabelPid)
      ) {
        await updateTask("analyst", tag, {
          sddLabelExitCode: 0,
          sddLabelExitSignal: null,
          sddLabelAppliedAt: new Date().toISOString(),
        });
      }
    }
  } catch (e) {
    console.error("[watcher] tick failed:", e);
  }
}

/**
 * Singleton guard. The watcher is started by instrumentation.ts
 * exactly once per Node process — never as a side-effect of
 * importing this module from a route, page, or API handler.
 * Routes that depend on the watcher (push, deploy-status, etc.)
 * MUST NOT import this file just to "ensure it's running"; the
 * guard below makes the import a no-op for any subsequent caller.
 *
 * Why a guard instead of `if (typeof window === "undefined") startWatcher()`?
 * - The old side-effect start ran on the FIRST server-side import.
 *   If the first import came from a route handler on a cold
 *   start, the handler could return its response BEFORE the
 *   watcher's first tick — leaving short-lived child PIDs
 *   (like `git push`, which finishes in ~1.2s) unrecorded in
 *   state.json forever. The UI then thinks the push is still
 *   in flight and locks downstream buttons (e.g. PR creation).
 * - instrumentation.ts runs ONCE at server startup, before any
 *   route can be hit, so the watcher's first tick lands well
 *   before any user action.
 * - The globalThis guard makes the import idempotent across
 *   Next.js hot reloads in dev and across the multiple module
 *   instances that Next.js can create for server code.
 */
declare global {
  // eslint-disable-next-line no-var
  var __openspecWatcherStarted: boolean | undefined;
}

export function startWatcher(): void {
  if (globalThis.__openspecWatcherStarted) return;
  globalThis.__openspecWatcherStarted = true;
  started = true;
  // eslint-disable-next-line no-console
  console.log(`[watcher] polling every ${POLL_MS}ms`);
  // tick immediately, then on interval
  void tick();
  intervalHandle = setInterval(() => {
    void tick();
  }, POLL_MS);
}

export function stopWatcher(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  started = false;
  globalThis.__openspecWatcherStarted = false;
}

// Best-effort cleanup on process exit (mainly for tests / hot reload)
if (typeof process !== "undefined" && process.on) {
  process.on("beforeExit", () => stopWatcher());
}

export {};