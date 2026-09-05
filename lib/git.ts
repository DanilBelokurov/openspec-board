import fs from "fs/promises";
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

export async function isGitRepo(dir: string): Promise<boolean> {
  // Strict: dir must BE the repo's toplevel (i.e. contain a .git entry).
  // Cheaper and symlink-proof vs `git rev-parse --show-toplevel`.
  try {
    const stat = await fs.stat(path.join(dir, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

export async function removeWorktree(
  repoDir: string,
  worktreePath: string,
): Promise<void> {
  await run("git", [
    "-C",
    repoDir,
    "worktree",
    "remove",
    "--force",
    worktreePath,
  ]);
}

export async function branchExists(repoDir: string, branch: string): Promise<boolean> {
  try {
    await run("git", [
      "-C",
      repoDir,
      "rev-parse",
      "--verify",
      `refs/heads/${branch}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export interface WorktreeResult {
  path: string;
  branch: string;
  created: boolean;
}

export async function createWorktree(
  repoDir: string,
  worktreePath: string,
  branch: string,
  startPoint?: string,
): Promise<WorktreeResult> {
  if (!(await isGitRepo(repoDir))) {
    throw new Error(`${repoDir} не является git-репозиторием`);
  }

  if (await pathExists(worktreePath)) {
    throw new Error(`Путь для worktree уже существует: ${worktreePath}`);
  }

  const exists = await branchExists(repoDir, branch);
  const args = exists
    ? ["-C", repoDir, "worktree", "add", worktreePath, branch]
    : startPoint
      ? [
          "-C",
          repoDir,
          "worktree",
          "add",
          worktreePath,
          "-b",
          branch,
          startPoint,
        ]
      : ["-C", repoDir, "worktree", "add", worktreePath, "-b", branch];

  await run("git", args);
  return { path: worktreePath, branch, created: !exists };
}

/**
 * Run `git fetch <remote> <branch>` to refresh the local
 * remote-tracking ref. Throws if the remote is missing or the
 * fetch fails — callers use this before creating a fresh
 * feature worktree so the new branch is based on an
 * up-to-date `origin/<base>`, not on stale local history.
 */
export async function fetchRemoteBranch(
  repoDir: string,
  remote: string,
  branch: string,
): Promise<void> {
  if (!(await isGitRepo(repoDir))) {
    throw new Error(`${repoDir} не является git-репозиторием`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(remote)) {
    throw new Error(`Недопустимое имя remote: "${remote}"`);
  }
  if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) {
    throw new Error(`Недопустимое имя ветки для fetch: "${branch}"`);
  }
  await run("git", ["-C", repoDir, "fetch", remote, branch]);
}

/**
 * Pick a free `feature/<jiraId>` worktree+branch pair. Tries
 * the bare `<jiraId>` first, then `<jiraId>-1`, `<jiraId>-2`,
 * ... until it finds a worktree path that doesn't exist on disk.
 *
 * The branch name follows the worktree name so that a
 * developer scanning `git worktree list` sees the same `<jiraId>`
 * token in both the path and the branch. The on-disk directory
 * is the only collision we care about — a stale `feature/<jiraId>`
 * branch with no worktree is fine, `git worktree add` will just
 * check it out into the new directory.
 *
 * Throws if no free name is found within a reasonable number of
 * attempts (1000 is a safety cap, not an expected ceiling).
 */
export async function pickFreeFeatureWorktree(
  repoDir: string,
  jiraId: string,
): Promise<{ branch: string; worktreePath: string }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(jiraId)) {
    throw new Error(
      `Недопустимый jiraId для имени ветки: "${jiraId}"`,
    );
  }
  const basename = repoDir.split("/").filter(Boolean).pop() ?? "repo";
  const parent = repoDir.replace(/\/+$/, "").split("/").slice(0, -1).join("/");
  const worktreesRoot = `${parent}/${basename}.worktrees`;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const worktreePath = `${worktreesRoot}/${jiraId}${suffix}`;
    if (!(await pathExists(worktreePath))) {
      return {
        branch: `feature/${jiraId}${suffix}`,
        worktreePath,
      };
    }
  }
  throw new Error(
    `Не удалось подобрать свободное имя для worktree после 1000 попыток`,
  );
}