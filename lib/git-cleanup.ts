/**
 * Tear-down helpers for the worktree + feature branch that
 * backs an analyst-mode task. Used by
 *   POST /api/changes/<tag>/delete
 * to clean up after the user discards a task.
 */

import path from "path";
import { execFile } from "child_process";

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts?.cwd, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `${cmd} ${args.join(" ")} failed: ${err.message}\n${stderr}`,
            ),
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    const fs = await import("fs/promises");
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop the worktree at <parent>/<basename>.worktrees/<jiraId>/
 * (or wherever the task's openspecWorktreePath actually points)
 * and delete the feature/<jiraId> branch locally. Best-effort:
 * each step logs its own failure and we keep going so a partial
 * state (e.g. worktree gone but branch present) still leaves the
 * user with a usable repo.
 *
 * Returns a short human-readable summary of what was attempted and
 * what actually succeeded.
 */
export async function cleanupTask(
  openspecDir: string,
  worktreePath: string,
  branchName: string,
): Promise<{ actions: { step: string; ok: boolean; error?: string }[] }> {
  const actions: { step: string; ok: boolean; error?: string }[] = [];

  // Step 1: git worktree remove --force <path>
  if (await exists(worktreePath)) {
    try {
      await run("git", [
        "-C",
        openspecDir,
        "worktree",
        "remove",
        "--force",
        worktreePath,
      ]);
      actions.push({ step: `worktree remove ${worktreePath}`, ok: true });
    } catch (e) {
      actions.push({
        step: `worktree remove ${worktreePath}`,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    actions.push({
      step: `worktree remove ${worktreePath}`,
      ok: true,
      error: "(path did not exist)",
    });
  }

  // Step 2: git worktree prune (clears the .git/worktrees entry so
  // the next `git worktree list` doesn't list the dead worktree).
  try {
    await run("git", ["-C", openspecDir, "worktree", "prune"]);
    actions.push({ step: "worktree prune", ok: true });
  } catch (e) {
    actions.push({
      step: "worktree prune",
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Step 3: git branch -D <branch>
  try {
    await run("git", [
      "-C",
      openspecDir,
      "branch",
      "-D",
      branchName,
    ]);
    actions.push({ step: `branch -D ${branchName}`, ok: true });
  } catch (e) {
    actions.push({
      step: `branch -D ${branchName}`,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return { actions };
}