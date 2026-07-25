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
  /** Step 1: `git submodule deinit -f -- <path>`. */
  deinit: "ok" | "failed" | "skipped";
  /** Step 2: `rm -rf .git/modules/<path>`. */
  modulesDirRemoved: boolean;
  /** Step 3: `git rm -f <path>`. */
  gitRm: "ok" | "failed" | "skipped";
  /** Working tree at `<cwd>/repos/<name>` is gone (via step 3 or the fs.rm fallback). */
  workTreeRemoved: boolean;
  /** Step 4: `[submodule "<name>"]` block trimmed from `.gitmodules`. */
  gitmodulesTrimmed: boolean;
}

/**
 * Tear down the git submodule at `<cwd>/repos/<name>/`. Implements
 * the canonical three-step removal procedure:
 *
 *   1. `git -C <cwd> submodule deinit -f -- <path>`
 *   2. `rm -rf <cwd>/.git/modules/<path>`
 *   3. `git -C <cwd> rm -f <path>`
 *
 * …plus a manual `.gitmodules` sweep (step 4) because `git rm -f`
 * does NOT update `.gitmodules` (only `git submodule rm` does, and
 * we explicitly avoid that convenience wrapper). Idempotent:
 * re-running on a missing directory is a no-op.
 *
 * In-flight build/visualize PIDs are SIGTERMed first so an active
 * indexer doesn't race the rm.
 */
export async function removeSubmodule(
  name: string,
  pids?: { buildPid?: number | null; visualizePid?: number | null },
): Promise<RemoveSubmoduleResult> {
  const repoDir = process.cwd();
  const subPath = path.posix.join("repos", name);
  const target = path.join(repoDir, "repos", name);
  const modulesDir = path.join(repoDir, ".git", "modules", "repos", name);

  // SIGTERM any in-flight build/visualize so they don't race the rm.
  const buildOutcome = killPid(pids?.buildPid);
  const visualizeOutcome = killPid(pids?.visualizePid);

  const parentIsGitRepo = await isGitRepo(repoDir);
  let deinit: "ok" | "failed" | "skipped" = "skipped";
  let gitRm: "ok" | "failed" | "skipped" = "skipped";

  // Pre-check: does the submodule exist in the index?
  // Without an index entry, both `git submodule deinit` and
  // `git rm -f` fail with "did not match any files" — which
  // is the desired state, not a failure (no entry to remove).
  // This project's setup keeps submodules untracked, so the
  // index entry is typically absent.
  let hasIndexEntry = false;
  if (parentIsGitRepo) {
    try {
      const { stdout } = await run(
        "git",
        ["-C", repoDir, "ls-files", "--stage", "--", subPath],
        { cwd: repoDir },
      );
      hasIndexEntry = stdout.trim().length > 0;
    } catch (e) {
      console.warn(`git ls-files for ${name} failed:`, e);
    }
  }

  if (parentIsGitRepo) {
    // Step 1: git submodule deinit -f -- <path>
    // The `--` ensures the path can't be parsed as a flag.
    if (hasIndexEntry) {
      try {
        await run(
          "git",
          ["-C", repoDir, "submodule", "deinit", "-f", "--", subPath],
          { cwd: repoDir },
        );
        deinit = "ok";
      } catch (e) {
        console.warn(`git submodule deinit for ${name} failed:`, e);
        deinit = "failed";
      }
    } else {
      deinit = "skipped";
    }
  }

  // Step 2: rm -rf .git/modules/<path>
  // Run after step 1 so deinit has had a chance to clean up its
  // internal state. Safe to run unconditionally — `fs.rm` with
  // `force: true` ignores ENOENT.
  let modulesDirRemoved = false;
  if (await exists(modulesDir)) {
    try {
      await fs.rm(modulesDir, { recursive: true, force: true });
      modulesDirRemoved = true;
    } catch (e) {
      console.warn(`rm -rf ${modulesDir} failed:`, e);
    }
  } else {
    modulesDirRemoved = true;
  }

  if (parentIsGitRepo) {
    // Step 3: git rm -f <path>
    // `git rm -f` removes both the index entry and the working
    // tree. After step 1's deinit the working tree may already
    // be gone — git rm -f still works on the index entry alone.
    // Skipped when the index has no entry (see pre-check above).
    if (hasIndexEntry) {
      try {
        await run(
          "git",
          ["-C", repoDir, "rm", "-f", subPath],
          { cwd: repoDir },
        );
        gitRm = "ok";
      } catch (e) {
        console.warn(`git rm -f for ${name} failed:`, e);
        gitRm = "failed";
      }
    } else {
      gitRm = "skipped";
    }
  }

  // Fallback: ensure the working tree is gone regardless of what
  // the git ops did (handles the case where parent isn't a git
  // repo, or all of steps 1–3 were skipped).
  let workTreeRemoved = false;
  if (await exists(target)) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      workTreeRemoved = true;
    } catch (e) {
      console.warn(`rm -rf ${target} failed:`, e);
    }
  } else {
    workTreeRemoved = true;
  }

  // Step 4: trim .gitmodules manually. `git rm -f` does NOT touch
  // .gitmodules — only `git submodule rm` does. Since we use the
  // explicit three-step procedure, we own this cleanup.
  let gitmodulesTrimmed = false;
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

  return {
    name,
    parentIsGitRepo,
    buildPid: buildOutcome,
    visualizePid: visualizeOutcome,
    deinit,
    modulesDirRemoved,
    gitRm,
    workTreeRemoved,
    gitmodulesTrimmed,
  };
}