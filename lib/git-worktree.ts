/**
 * Git helpers for the analyst-mode proposal-creation flow.
 *
 * The flow runs entirely on a dedicated worktree on a feature branch,
 * branched from a configurable "main" branch (typically `master` or
 * `main`, set in config as `defaultBranch`). The main branch is updated
 * from origin on each task creation. See app/api/changes POST handler.
 *
 * Existing developer-mode helpers (createWorktree, removeWorktree,
 * branchExists, etc.) live in lib/git.ts — they target the simpler
 * "branch from existing local ref" path used by /api/changes/[tag]/start.
 */

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
          const e = new Error(
            `${cmd} ${args.join(" ")} failed: ${err.message}\n${stderr}`,
          );
          reject(e);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

async function branchExistsLocal(repoDir: string, branch: string): Promise<boolean> {
  try {
    await run("git", [
      "-C",
      repoDir,
      "rev-parse",
      "--verify",
      `--quiet`,
      `refs/heads/${branch}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch <branch> from origin and fast-forward the local
 * refs/heads/<branch> to origin/<branch> (creating it locally if it
 * doesn't exist yet).
 *
 * We update the ref directly via `update-ref` rather than going through
 * `git pull`/`merge --ff-only` so the call is robust to the main repo
 * being on a different branch (or being on <branch> with uncommitted
 * changes). The working tree of the main repo is NOT touched — only
 * the ref moves — so any concurrent work-in-progress there is
 * preserved. The downstream `git worktree add ... <branch>` then reads
 * the updated ref and produces a fresh worktree at the new tip.
 */
export async function ensureBranchUpToDate(
  repoDir: string,
  branch: string,
): Promise<void> {
  await run("git", ["-C", repoDir, "fetch", "origin", branch]);

  const localExists = await branchExistsLocal(repoDir, branch);
  if (localExists) {
    await run("git", [
      "-C",
      repoDir,
      "update-ref",
      `refs/heads/${branch}`,
      `refs/remotes/origin/${branch}`,
    ]);
  } else {
    await run("git", [
      "-C",
      repoDir,
      "branch",
      branch,
      `refs/remotes/origin/${branch}`,
    ]);
  }
}

export interface WorktreeResult {
  path: string;
  branch: string;
  created: boolean;
}

/**
 * Create a worktree at <worktreePath> on a new branch <newBranch>, with
 * the branch's tip set to the (just-updated) local <sourceBranch>.
 *
 * Caller is responsible for ensuring the parent dir exists / is the
 * standard `<repoBasename>.worktrees/` sibling pattern. Idempotency
 * against an existing path or branch is NOT done here — surface a
 * 409 upstream instead.
 */
export async function createWorktreeFromBranch(
  repoDir: string,
  worktreePath: string,
  newBranch: string,
  sourceBranch: string,
): Promise<WorktreeResult> {
  await ensureBranchUpToDate(repoDir, sourceBranch);

  await run("git", [
    "-C",
    repoDir,
    "worktree",
    "add",
    worktreePath,
    "-b",
    newBranch,
    sourceBranch,
  ]);
  return { path: worktreePath, branch: newBranch, created: true };
}