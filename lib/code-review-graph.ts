/**
 * Code-review-graph pipeline driver. The user adds repos as
 * submodules via the Settings panel; once `git submodule add`
 * succeeds we kick off `uvx code-review-graph build` against the
 * freshly-cloned working tree and track the spawned process via
 * its PID. A separate watcher (lib/watcher.ts) flips the exit code
 * field on the repo entry once the process exits.
 *
 * Why detached: build can take minutes on a large repo and the
 * /api/repos handler must return quickly to the UI.
 */

import { spawnDetachedWithLog, ensureLogDir } from "./process-logger";

/**
 * Spawn the code-review-graph build for a freshly-added repo.
 * Returns the PID (or null on immediate failure). Logs go to
 * `.sdd-board/logs/repos/<name>.graph-build.log` so the user can
 * inspect progress from the file system.
 *
 * The path layout intentionally matches what the user requested:
 *
 *   uvx code-review-graph build
 *     --repo <openspecDir>/repos/<name>
 *     --data-dir graph/<name>/
 *
 * `--data-dir` lives alongside the openspecDir (so the index is
 * tracked by the openspec repo if the user later commits it).
 */
export function spawnCodeReviewGraphBuild(
  worktree: string,
  repoName: string,
): number | null {
  ensureLogDir();
  const logFile = `.sdd-board/logs/repos/${repoName}.graph-build.log`;
  // The repo worktree is <openspecDir>/repos/<name>; --data-dir is
  // a sibling-tree under <openspecDir>/graph/<name>.
  const repoPath = worktree;
  const dataDir = `graph/${repoName}`;

  try {
    const result = spawnDetachedWithLog({
      command: "uvx",
      argv: [
        "code-review-graph",
        "build",
        "--repo",
        repoPath,
        "--data-dir",
        dataDir,
      ],
      logFile,
      header: `code-review-graph build for ${repoName}`,
      cwd: worktree,
    });
    return result.pid || null;
  } catch (e) {
    console.error(`code-review-graph build spawn threw:`, e);
    return null;
  }
}