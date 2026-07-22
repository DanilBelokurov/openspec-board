/**
 * Git helpers for the user-tracked repos the Settings panel exposes.
 *
 * Each "repo" is a git submodule installed under
 *   <openspecDirParent>/repos/<name>/
 * The submodule is initialised from <url> and the worktree is
 * checked out at the user-chosen <branch>. Subsequent calls re-use
 * the existing clone (idempotent on re-add) — they fetch origin and
 * `git checkout` the configured branch.
 *
 * The submodule is added under the PARENT of openspecDir, not
 * inside openspec/changes/, so the proposal-generation worktree
 * (which is created by `git worktree add ... master` on the
 * openspecDir's parent repo) doesn't accidentally try to also be
 * the parent of a submodule.
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
 * Result of adding / re-checking out a submodule. `created` is true
 * for the first install, false when we re-used an existing clone.
 */
export interface AddSubmoduleResult {
  name: string;
  path: string;
  branch: string;
  created: boolean;
}

/**
 * Ensure <parent>/repos/<name> exists as a checkout of <url> at
 * <branch>. Idempotent: if the path already has a clone, skip
 * `submodule add` and only re-run fetch + checkout.
 *
 * - repoDir: the openspecDir whose PARENT repo will own the
 *   submodule (must be a git working tree)
 * - name:   the directory name inside repos/
 * - url:    the remote URL to clone
 * - branch: the branch to check out (after a fetch)
 */
export async function addOrCheckoutSubmodule(
  repoDir: string,
  name: string,
  url: string,
  branch: string,
): Promise<AddSubmoduleResult> {
  // The submodule's parent repo is the one that contains
  // openspecDir. For our default layout that's `<repo>/openspec/`
  // itself; submodule ops run there so .git/modules/repos/<name>/
  // lands correctly.
  if (!(await exists(repoDir))) {
    throw new Error(`repoDir не существует: ${repoDir}`);
  }

  const reposDir = path.join(repoDir, "repos");
  const target = path.join(reposDir, name);

  let created = false;
  if (!(await exists(target))) {
    // `git submodule add <url> repos/<name>` clones, registers the
    // submodule in .gitmodules, and checks out the default branch.
    // We don't pass -b here because the requested branch may not
    // exist locally yet — we fetch + checkout below to handle both
    // existing-branch and tag-name cases.
    await run(
      "git",
      ["-C", repoDir, "submodule", "add", url, path.posix.join("repos", name)],
      { cwd: repoDir },
    );
    created = true;
  } else {
    // Submodule dir already exists (re-add or first run after a
    // manual clone). Make sure git knows about it.
    await run(
      "git",
      ["-C", repoDir, "submodule", "update", "--init", path.posix.join("repos", name)],
      { cwd: repoDir },
    ).catch(() => {
      /* ignore — already initialised is fine */
    });
  }

  // Now fetch and checkout the requested branch inside the
  // submodule. Use -C so each command runs against the submodule
  // working tree, not the parent.
  await run("git", ["-C", target, "fetch", "origin", branch], {
    cwd: target,
  });
  await run("git", ["-C", target, "checkout", branch], {
    cwd: target,
  });

  return { name, path: target, branch, created };
}