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
    : ["-C", repoDir, "worktree", "add", worktreePath, "-b", branch];

  await run("git", args);
  return { path: worktreePath, branch, created: !exists };
}

/**
 * Extract ticket id (e.g. ENG-123) from various Jira URL formats:
 *   - https://company.atlassian.net/browse/ENG-123 → ENG-123
 *   - https://company.atlassian.net/browse/ENG-123?foo=bar → ENG-123
 *   - ENG-123 → ENG-123
 *   - abc/ENG-123 → ENG-123 (last path segment)
 */
export function extractJiraId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try to parse as URL first
  try {
    const u = new URL(trimmed);
    const parts = u.pathname.split("/").filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(parts[i])) {
        return parts[i];
      }
    }
    // Fallback to last path segment
    return parts[parts.length - 1] ?? null;
  } catch {
    // Not a URL — treat as raw ticket id
    const m = trimmed.match(/[A-Za-z][A-Za-z0-9_]*-\d+/);
    return m ? m[0] : null;
  }
}

export function repoBasename(p: string): string {
  return path.basename(p.replace(/\/+$/, ""));
}