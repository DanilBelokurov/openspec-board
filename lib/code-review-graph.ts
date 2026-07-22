/**
 * Code-review-graph pipeline driver. The user adds repos as
 * submodules via the Settings panel; once `git submodule add`
 * succeeds we kick off a two-step pipeline against the
 * freshly-cloned working tree and track each step via its PID:
 *
 *   1. `uvx code-review-graph build     --repo <p> --data-dir <d>`
 *        collects raw data (files, references, …) into <d>.
 *   2. `uvx code-review-graph visualize --repo <p> --data-dir <d>
 *        --format json`
 *        produces the graph JSON the UI consumes. We treat the
 *        graph as "built" only after step 2 exits with code 0.
 *
 * A separate watcher (lib/watcher.ts) flips the exit-code field on
 * each step as it dies, and chains step 2 on after step 1 exits
 * with code 0.
 *
 * Why detached: both steps can take minutes on a large repo and
 * the /api/repos handler must return quickly to the UI.
 */

import fs from "fs/promises";
import path from "path";
import { spawnDetachedWithLog, ensureLogDir } from "./process-logger";

interface SpawnBuildResult {
  pid: number | null;
  logFile: string;
  error?: string;
}

/**
 * Ensure the parent directory of a repo log file exists.
 * `ensureLogDir()` only creates `.sdd-board/logs/`; the per-repo
 * log files live one level deeper at `.sdd-board/logs/repos/`.
 */
async function ensureRepoLogDir(): Promise<void> {
  await ensureLogDir();
  await fs.mkdir(path.join(process.cwd(), ".sdd-board", "logs", "repos"), {
    recursive: true,
  });
}

/**
 * The code-review-graph CLI must point at the cloned submodule
 * directory. Submodules live under `<cwd>/repos/<name>/` where
 * `<cwd>` is the sdd-board project's own working directory (i.e.
 * the same place `.sdd-board/` lives in), not the openspec store.
 * Keeping both repos/ and graphs/ inside the ssd-board project
 * means the graph index can be version-controlled alongside the
 * tool that drives it.
 */
function repoPath(repoName: string): string {
  return path.join(process.cwd(), "repos", repoName);
}

/**
 * `<cwd>/graphs/<name>/` — sibling of repos/, so the data
 * directory sits next to the submodule working tree. Always
 * absolute so the CLI doesn't have to rely on its own CWD
 * resolution.
 */
function dataDir(repoName: string): string {
  return path.join(process.cwd(), "graphs", repoName);
}

export function buildLogPath(repoName: string): string {
  return `.sdd-board/logs/repos/${repoName}.graph-build.log`;
}

export function visualizeLogPath(repoName: string): string {
  return `.sdd-board/logs/repos/${repoName}.graph-visualize.log`;
}

/**
 * Spawn the code-review-graph build for a freshly-added repo.
 * Logs go to `.sdd-board/logs/repos/<name>.graph-build.log`.
 */
export async function spawnCodeReviewGraphBuild(
  repoName: string,
): Promise<SpawnBuildResult> {
  await ensureRepoLogDir();
  const logFile = buildLogPath(repoName);
  try {
    const result = spawnDetachedWithLog({
      command: "uvx",
      argv: [
        "code-review-graph",
        "build",
        "--repo",
        repoPath(repoName),
        "--data-dir",
        dataDir(repoName),
      ],
      logFile,
      header: `code-review-graph build for ${repoName}`,
      cwd: process.cwd(),
    });
    return { pid: result.pid || null, logFile };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`code-review-graph build spawn threw:`, message);
    return { pid: null, logFile, error: message };
  }
}

/**
 * Spawn the visualize step for a repo whose build has just
 * completed. Logs go to `.sdd-board/logs/repos/<name>.graph-visualize.log`.
 */
export async function spawnCodeReviewGraphVisualize(
  repoName: string,
): Promise<SpawnBuildResult> {
  await ensureRepoLogDir();
  const logFile = visualizeLogPath(repoName);
  try {
    const result = spawnDetachedWithLog({
      command: "uvx",
      argv: [
        "code-review-graph",
        "visualize",
        "--repo",
        repoPath(repoName),
        "--data-dir",
        dataDir(repoName),
        "--format",
        "json",
      ],
      logFile,
      header: `code-review-graph visualize for ${repoName}`,
      cwd: process.cwd(),
    });
    return { pid: result.pid || null, logFile };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`code-review-graph visualize spawn threw:`, message);
    return { pid: null, logFile, error: message };
  }
}