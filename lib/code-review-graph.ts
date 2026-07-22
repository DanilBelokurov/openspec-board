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
 * directory, not at openspecDir itself. Submodules live under
 * `<openspecDir>/repos/<name>/`.
 */
function repoPath(openspecDir: string, repoName: string): string {
  return path.join(openspecDir, "repos", repoName);
}

function dataDir(repoName: string): string {
  return `graph/${repoName}`;
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
  openspecDir: string,
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
        repoPath(openspecDir, repoName),
        "--data-dir",
        dataDir(repoName),
      ],
      logFile,
      header: `code-review-graph build for ${repoName}`,
      cwd: openspecDir,
    });
    return { pid: result.pid || null, logFile };
  } catch (e) {
    console.error(`code-review-graph build spawn threw:`, e);
    return { pid: null, logFile };
  }
}

/**
 * Spawn the visualize step for a repo whose build has just
 * completed. Logs go to `.sdd-board/logs/repos/<name>.graph-visualize.log`.
 */
export async function spawnCodeReviewGraphVisualize(
  openspecDir: string,
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
        repoPath(openspecDir, repoName),
        "--data-dir",
        dataDir(repoName),
        "--format",
        "json",
      ],
      logFile,
      header: `code-review-graph visualize for ${repoName}`,
      cwd: openspecDir,
    });
    return { pid: result.pid || null, logFile };
  } catch (e) {
    console.error(`code-review-graph visualize spawn threw:`, e);
    return { pid: null, logFile };
  }
}