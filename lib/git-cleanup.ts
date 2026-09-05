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
export interface CleanupOptions {
  /**
   * If true, also remove the branch from the `origin` remote via
   * `git push origin --delete <branch>`. Off by default — most
   * users want to keep the remote branch as a safety net (e.g.
   * to recover commits if the discard was a mistake) and only
   * clean up remote branches explicitly.
   *
   * The step is best-effort like the others: a failure here
   * does not roll back the local worktree/branch removal.
   */
  deleteRemote?: boolean;
  /**
   * Optional path to a *code-repo* worktree that belongs to this
   * task but lives in a different repo from the openspec worktree
   * passed as `worktreePath`. Per-service child tasks own their
   * own code-repo worktree (created by `/api/changes/<tag>/confirm`)
   * in addition to the shared openspec worktree, so a full
   * teardown has to clean both. When set, we run an extra
   * `git worktree remove --force <codeRepoPath>/<codeWorktreePath>`
   * plus `git worktree prune` against the code repo. The shared
   * `git branch -D` step that runs on `openspecDir` still applies
   * because the code-repo worktree is on the same
   * `feature/<JIRA-ID>` branch.
   */
  codeRepoPath?: string;
  codeWorktreePath?: string;
  /**
   * Skip the local-branch deletion step (`git branch -D`) AND
   * the remote delete (`git push origin --delete`). Used when
   * teardown runs in a cascade — every sibling + the parent all
   * share the same `feature/<JIRA-ID>` branch, so we only want
   * to drop it once. The caller is responsible for the first
   * non-skipping call on each batch.
   */
  skipBranchDelete?: boolean;
}

export async function cleanupTask(
  openspecDir: string,
  worktreePath: string,
  branchName: string,
  options: CleanupOptions = {},
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

  // Step 3: git push origin --delete <branch> (only when requested,
  // AND we're the call that owns the branch delete — see
  // `skipBranchDelete` below). Pre-flight with `git ls-remote
  // --heads origin <branch>` so we don't fail loudly when the
  // branch was never pushed (e.g. a brand-new task aborted
  // before its first push). Absence is reported as ok=true with
  // a "(not on remote)" note.
  if (options.deleteRemote && !options.skipBranchDelete) {
    let remoteHasBranch = false;
    try {
      const { stdout } = await run("git", [
        "-C",
        openspecDir,
        "ls-remote",
        "--heads",
        "origin",
        branchName,
      ]);
      remoteHasBranch = stdout.trim().length > 0;
    } catch (e) {
      actions.push({
        step: `ls-remote origin ${branchName}`,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    if (remoteHasBranch) {
      try {
        await run("git", [
          "-C",
          openspecDir,
          "push",
          "origin",
          "--delete",
          branchName,
        ]);
        actions.push({
          step: `push origin --delete ${branchName}`,
          ok: true,
        });
      } catch (e) {
        actions.push({
          step: `push origin --delete ${branchName}`,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      actions.push({
        step: `push origin --delete ${branchName}`,
        ok: true,
        error: "(branch not on remote)",
      });
    }
  }

  // Step 4: git branch -D <branch>. Skipped when `skipBranchDelete`
  // is set because the branch is shared across a cascade
  // (every sibling + the parent sit on the same
  // `feature/<JIRA-ID>`) — only the first call in the cascade
  // is allowed to actually delete it.
  if (!options.skipBranchDelete) {
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
  } else {
    actions.push({
      step: `branch -D ${branchName}`,
      ok: true,
      error: "(skipped — shared with sibling/parent in cascade)",
    });
  }

  // Step 5: per-service child tasks also own a worktree in
  // the *code* repo (separate from the shared openspec
  // worktree torn down above). The code-repo worktree was
  // created by /confirm when the dev selected a service+repo
  // pair, and `git worktree remove` against `openspecDir`
  // does NOT see it because it's a sibling repo. We have to
  // call `worktree remove` against `codeRepoPath` to drop
  // it. We do not touch the code-repo's `feature/<JIRA-ID>`
  // branch here — the openspec-dir branch delete in step 4
  // only affects `openspecDir`, and the shared branch is
  // what gets pushed/deleted from the openspec side of the
  // project (the canonical reference repo). Each code repo
  // may carry its own local-only branch copy that the user
  // can clean up later; that's outside the scope of "delete
  // this task". Skipped entirely when both `codeRepoPath`
  // and `codeWorktreePath` are absent (the parent task has
  // no code-repo worktree).
  if (options.codeRepoPath && options.codeWorktreePath) {
    const codeLabel = `${options.codeRepoPath} ← ${options.codeWorktreePath}`;
    if (await exists(options.codeWorktreePath)) {
      try {
        await run("git", [
          "-C",
          options.codeRepoPath,
          "worktree",
          "remove",
          "--force",
          options.codeWorktreePath,
        ]);
        actions.push({
          step: `worktree remove (code) ${codeLabel}`,
          ok: true,
        });
      } catch (e) {
        actions.push({
          step: `worktree remove (code) ${codeLabel}`,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      actions.push({
        step: `worktree remove (code) ${codeLabel}`,
        ok: true,
        error: "(path did not exist)",
      });
    }
    // Prune the code-repo's worktree metadata so a subsequent
    // `git worktree list` from inside the code repo doesn't
    // list the dead worktree.
    try {
      await run("git", ["-C", options.codeRepoPath, "worktree", "prune"]);
      actions.push({
        step: "worktree prune (code)",
        ok: true,
      });
    } catch (e) {
      actions.push({
        step: "worktree prune (code)",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { actions };
}