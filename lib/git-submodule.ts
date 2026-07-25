/**
 * Git helpers for the user-tracked repos the Settings panel exposes.
 *
 * Each "repo" is a git submodule installed under
 *   <cwd>/repos/<name>/
 * where `<cwd>` is the directory the Next.js process was launched
 * from (i.e. the sdd-board project's own working directory, NOT
 * the openspec store the user is editing). The submodule is
 * initialised from <url> and the worktree is checked out at the
 * user-chosen <branch>. Subsequent calls re-use the existing
 * clone (idempotent on re-add) — they fetch origin and `git
 * checkout` the configured branch.
 *
 * Keeping the submodule inside the sdd-board project folder (rather
 * than next to openspecDir) means the graph index can sit alongside
 * the code that drives it, and the `.gitmodules`/`repos/` stay
 * version-controlled with the ssd-board repo if the user ever
 * commits them.
 */

import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { isGitRepo } from "./git";

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
 * Ensure `<cwd>/repos/<name>` exists as a checkout of <url> at
 * <branch>. Idempotent: if the path already has a clone, skip
 * `submodule add` and only re-run fetch + checkout.
 */
export async function addOrCheckoutSubmodule(
  name: string,
  url: string,
  branch: string,
): Promise<AddSubmoduleResult> {
  // The sdd-board project's own working directory owns the
  // submodule. process.cwd() is the Next.js process cwd, which is
  // the project's root when launched with `next dev` / `next start`.
  const repoDir = process.cwd();
  if (!(await exists(repoDir))) {
    throw new Error(`cwd не существует: ${repoDir}`);
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

/**
 * Per-pid result of a `process.kill` best-effort. ESRCH (no such
 * process) is treated as success — the process already died on
 * its own, which is exactly what we wanted.
 */
type KillOutcome = "killed" | "already-gone" | "skipped";

function killPid(pid: number | null | undefined): KillOutcome {
  if (pid == null || !Number.isInteger(pid) || pid <= 0) return "skipped";
  try {
    process.kill(pid, "SIGTERM");
    return "killed";
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ESRCH") return "already-gone";
    return "skipped";
  }
}

/**
 * Strip the `[submodule "<name>"]` block from a `.gitmodules` file.
 * `.gitmodules` uses an INI-like format with one section per
 * submodule; sections are separated by blank lines. Used as a
 * safety net for the cases where `git submodule rm` couldn't
 * run (parent not a git repo) or failed — otherwise re-adding
 * the same name later would conflict on the stale entry.
 */
function trimSubmoduleSection(content: string, name: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const match = line.match(/^\s*\[submodule\s+"([^"]+)"\]\s*$/);
    if (match) {
      skipping = match[1] === name;
      if (!skipping) out.push(line);
      continue;
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

export interface RemoveSubmoduleResult {
  name: string;
  parentIsGitRepo: boolean;
  buildPid: KillOutcome;
  visualizePid: KillOutcome;
  submoduleDeinit: "ok" | "failed" | "skipped";
  submoduleRm: "ok" | "failed" | "skipped";
  dirRemoved: boolean;
  gitmodulesTrimmed: boolean;
}

/**
 * Tear down a repo's git submodule footprint at `<cwd>/repos/<name>/`.
 * Best-effort throughout: any individual step that fails is logged
 * but does not abort the operation, so the caller always gets a
 * `RemoveSubmoduleResult` back to decide whether to surface
 * partial-failure to the user.
 *
 * Order matters:
 *   1. SIGTERM any in-flight build/visualize PIDs so they don't
 *      keep writing into the files we're about to remove.
 *   2. `git submodule deinit -f` to unregister the worktree.
 *   3. `git submodule rm -f` to remove the entry from `.gitmodules`
 *      and the git index.
 *   4. Fallback `rm -rf` of the directory if any of the above
 *      left it behind (parent not a git repo, or git ops failed).
 *   5. Trim `.gitmodules` manually only if step 3 skipped/failed —
 *      otherwise git already updated the file.
 */
export async function removeSubmodule(
  name: string,
  pids?: { buildPid?: number | null; visualizePid?: number | null },
): Promise<RemoveSubmoduleResult> {
  const repoDir = process.cwd();
  const target = path.join(repoDir, "repos", name);

  const buildOutcome = killPid(pids?.buildPid);
  const visualizeOutcome = killPid(pids?.visualizePid);

  const parentIsGitRepo = await isGitRepo(repoDir);
  let submoduleDeinit: "ok" | "failed" | "skipped" = "skipped";
  let submoduleRm: "ok" | "failed" | "skipped" = "skipped";

  if (parentIsGitRepo) {
    try {
      await run(
        "git",
        [
          "-C",
          repoDir,
          "submodule",
          "deinit",
          "-f",
          path.posix.join("repos", name),
        ],
        { cwd: repoDir },
      );
      submoduleDeinit = "ok";
    } catch (e) {
      console.warn(`git submodule deinit for ${name} failed:`, e);
      submoduleDeinit = "failed";
    }
    try {
      await run(
        "git",
        [
          "-C",
          repoDir,
          "submodule",
          "rm",
          "-f",
          path.posix.join("repos", name),
        ],
        { cwd: repoDir },
      );
      submoduleRm = "ok";
    } catch (e) {
      console.warn(`git submodule rm for ${name} failed:`, e);
      submoduleRm = "failed";
    }
  }

  // Fallback: nuke the directory if any of the git ops left it
  // behind. Safe to run even when nothing's there — `fs.rm` with
  // `force: true` ignores ENOENT.
  let dirRemoved = false;
  if (await exists(target)) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      dirRemoved = true;
    } catch (e) {
      console.warn(`rm -rf ${target} failed:`, e);
    }
  } else {
    dirRemoved = true;
  }

  // If `git submodule rm` didn't take care of `.gitmodules`,
  // do it manually so the next add of the same name doesn't see
  // a stale entry.
  let gitmodulesTrimmed = false;
  if (submoduleRm !== "ok") {
    const gitmodulesPath = path.join(repoDir, ".gitmodules");
    if (await exists(gitmodulesPath)) {
      try {
        const content = await fs.readFile(gitmodulesPath, "utf-8");
        const trimmed = trimSubmoduleSection(content, name);
        if (trimmed !== content) {
          await fs.writeFile(gitmodulesPath, trimmed, "utf-8");
          gitmodulesTrimmed = true;
        }
      } catch (e) {
        console.warn(`trimming .gitmodules for ${name} failed:`, e);
      }
    }
  }

  return {
    name,
    parentIsGitRepo,
    buildPid: buildOutcome,
    visualizePid: visualizeOutcome,
    submoduleDeinit,
    submoduleRm,
    dirRemoved,
    gitmodulesTrimmed,
  };
}