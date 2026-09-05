/**
 * Read-only materialization of remote tasks into local git worktrees.
 *
 * When a remote feature branch (published by another user) is picked
 * up by the analyst-mode scan, its change-proposal lives only on that
 * branch — there is no local worktree, so the board and detail page
 * cannot open files in a Finder/editor the way they can for local
 * tasks.
 *
 * This module creates and keeps up-to-date a DETACHED-HEAD worktree
 * per remote branch, mirrored under
 *   <openspecParent>/<openspecBasename>.remote-worktrees/<feature>/
 *
 * A detached HEAD (instead of a named `feature/...` branch) is what
 * makes the mirror read-only at the git level: the author's branch is
 * only ever referenced through `refs/remotes/origin/<branch>`, never
 * checked out onto a local branch that a user could push. The UI still
 * treats the task as `remote: true` and hides the mutating buttons
 * (confirm / pencil / delete) — see the detail page guards.
 *
 * Kept as a mirror, not a local task: the worktree path is stored on
 * the TaskEntry (`openspecWorktreePath`) but `remote` stays true and
 * the task never becomes locally-editable.
 *
 * Lifecycle:
 *   - creation:   `git worktree add --detach <path> refs/remotes/origin/<branch>`
 *   - auto-reset: `git -C <path> fetch origin <branch>` (updates the
 *                 shared refs/remotes) then
 *                 `git -C <path> reset --hard refs/remotes/origin/<branch>`
 *                 — runs whenever the scan sees a new sourceCommit
 *                 (force-push upstream) or when the mirror is missing.
 */

import { execFile } from "child_process";
import path from "path";
import { repoBasename } from "./path-utils";
import { isGitRepo, pathExists } from "./git";

function run(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `git ${args.join(" ")} failed: ${err.message}\n${stderr}`,
            ),
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * Derive the branch a `remoteRef` points at and validate it. A remote
 * ref is expected to have the shape `origin/feature/<feature>`. We
 * only accept the `feature/` namespace (that's where remote tasks are
 * published) and validate the feature token so it can't be used for
 * path traversal or odd directory names.
 */
export function parseRemoteRef(remoteRef: string): {
  branch: string;
  feature: string;
} {
  // remote-tracking ref: "origin/feature/OKECS-13078".
  const m = remoteRef.match(/^origin\/feature\/([A-Za-z0-9][A-Za-z0-9_.-]*)$/);
  if (!m) {
    throw new Error(`Недопустимый remoteRef: "${remoteRef}"`);
  }
  const feature = m[1];
  return { branch: `feature/${feature}`, feature };
}

/**
 * Resolve the on-disk path for a remote task's read-only worktree,
 * without creating it. Mirrors the local-worktree convention but under
 * a `.remote-worktrees` namespace so it can never collide with a
 * local `feature/<jiraId>` worktree or an analyst-mode task for the
 * same Jira ticket.
 *
 * The feature token comes from `parseRemoteRef`, which already
 * rejects `..` / `/` / spaces, so the resulting path is safe
 * to pass to `git worktree add` and to `fs` operations. The
 * sibling `<basename>.worktrees/` (local-worktree convention)
 * is intentionally NOT touched here — the two namespaces are
 * disjoint by construction.
 */
export function remoteWorktreePath(
  openspecDir: string,
  remoteRef: string,
): string {
  const { feature } = parseRemoteRef(remoteRef);
  const basename = repoBasename(openspecDir);
  const parent = path.dirname(openspecDir);
  const remoteRoot = path.join(parent, `${basename}.remote-worktrees`);
  // Defensive: refuse to materialise into a path that escapes
  // the parent (defence in depth — `parseRemoteRef` already
  // filters the feature token, but a regression there would
  // let a crafted remote ref point at an arbitrary sibling
  // directory).
  const resolved = path.resolve(remoteRoot, feature);
  if (!resolved.startsWith(path.resolve(remoteRoot) + path.sep)) {
    throw new Error(
      `Refusing to materialize remote worktree outside its namespace: ${resolved}`,
    );
  }
  return resolved;
}

/**
 * Ensure a read-only mirror worktree for the given remote branch
 * exists and points at the current `origin/<branch>` tip.
 *
 * - If the mirror already exists, we fetch the remote (which updates
 *   the shared refs/remotes) and `reset --hard` the detached HEAD onto
 *   the latest tip. This is the "auto-reset on force-push" path: the
 *   caller invokes it whenever a scan sees a changed sourceCommit.
 * - If the mirror is missing (first discovery, or an earlier failure),
 *   we create it detached from `refs/remotes/origin/<branch>`, which the
 *   scan has just fetched.
 *
 * Returns the mirror path on success. Throws on failure — the caller
 * leaves the task without `openspecWorktreePath` so the git-reading
 * fallback keeps the board correct in the interim.
 *
 * The reset is intentionally "hard": this is a read-only snapshot of a
 * published branch (the author's force-push should win), and there are
 * no local commits to preserve — the UI guards against editing.
 */
export async function ensureRemoteReadonlyWorktree(
  openspecDir: string,
  remoteRef: string,
): Promise<string> {
  const { branch } = parseRemoteRef(remoteRef);
  const worktreePath = remoteWorktreePath(openspecDir, remoteRef);

  if (await pathExists(worktreePath)) {
    if (!(await isGitRepo(worktreePath))) {
      throw new Error(
        `Read-only worktree path существует, но не является git-репозиторием: ${worktreePath}`,
      );
    }
    await run(worktreePath, ["fetch", "origin", branch]);
    await run(worktreePath, [
      "reset",
      "--hard",
      `refs/remotes/origin/${branch}`,
    ]);
    return worktreePath;
  }

  // First materialization. The scan already fetched the branch, so the
  // remote-tracking ref exists in the shared object store.
  await run(openspecDir, [
    "worktree",
    "add",
    "--detach",
    worktreePath,
    `refs/remotes/origin/${branch}`,
  ]);
  return worktreePath;
}

/**
 * Remove a remote task's read-only mirror worktree. Used when a remote
 * task is deleted from the board. Non-fatal: swallows errors so a
 * half-created mirror doesn't block deletion of the state entry.
 */
export async function removeRemoteReadonlyWorktree(
  openspecDir: string,
  remoteRef: string,
): Promise<void> {
  try {
    const worktreePath = remoteWorktreePath(openspecDir, remoteRef);
    if (!(await pathExists(worktreePath))) return;
    await run(openspecDir, ["worktree", "remove", "--force", worktreePath]);
  } catch (e) {
    // Best-effort cleanup.
    console.warn("[remote-worktree] remove failed:", e);
  }
}

/**
 * True when the given remote task's mirror worktree is present on
 * disk. Cheap existence check for callers that want to decide whether
 * to read from the filesystem or fall back to git.
 */
export async function remoteWorktreeExists(
  openspecDir: string,
  remoteRef: string,
): Promise<boolean> {
  const p = remoteWorktreePath(openspecDir, remoteRef);
  if (!(await pathExists(p))) return false;
  return isGitRepo(p);
}

// ── Take-over: promote a remote task to a locally editable one ──────

/**
 * Error carrying a user-facing message for an expected take-over
 * refusal (branch busy, remote ref gone, path occupied). The route
 * maps it to 409; anything else surfaces as 500.
 */
export class TakeOverError extends Error {}

async function refExists(repoDir: string, ref: string): Promise<boolean> {
  try {
    await run(repoDir, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Standard local-worktree path for a feature branch — the same
 * `<openspecParent>/<openspecBasename>.worktrees/<jiraId>/` convention
 * POST /api/changes uses. Kept in sync so a taken-over task is
 * indistinguishable from a locally-created one downstream.
 */
export function localWorktreePath(
  openspecDir: string,
  branch: string,
): string {
  const { feature } = parseRemoteRef(`origin/${branch}`);
  const basename = repoBasename(openspecDir);
  const parent = path.dirname(openspecDir);
  return path.join(parent, `${basename}.worktrees`, feature);
}

async function isRegisteredWorktree(
  repoDir: string,
  worktreePath: string,
): Promise<boolean> {
  const { stdout } = await run(repoDir, ["worktree", "list", "--porcelain"]);
  return stdout
    .split("\n")
    .some((line) => line.trim() === `worktree ${worktreePath}`);
}

/**
 * Branch (or "HEAD" when detached) the given registered worktree is
 * currently on.
 */
async function worktreeBranch(worktreePath: string): Promise<string> {
  const { stdout } = await run(worktreePath, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  return stdout.trim();
}

export interface TakeOverResult {
  worktreePath: string;
  branch: string;
  /**
   * True when a local worktree on the target branch already existed
   * at the standard path and was adopted instead of created.
   */
  adoptedExisting: boolean;
}

export interface TakeOverOptions {
  /**
   * Whether to remove the read-only mirror worktree after a
   * successful promotion. The route flips this to `false`,
   * updates state.json first, then removes the mirror
   * separately — this ordering keeps state.json authoritative
   * even if the process crashes mid-take-over (otherwise a
   * crash between mirror-removal and state-write would leave
   * state pointing at a non-existent mirror). Default: true
   * (matches the original behaviour).
   */
  removeMirror?: boolean;
}

/**
 * Promote a remote task's read-only mirror into a locally editable
 * worktree on a real `feature/<jiraId>` branch, branched from the
 * remote tip. This is the "Взять в работу" action — after it the task
 * stops being a read-only mirror and the ordinary analyst pipeline
 * (pencil edits, confirm, push) applies.
 *
 * Guarantees:
 *   - The local branch is created from `refs/remotes/origin/<branch>`
 *     only when it doesn't exist yet. An EXISTING local branch is
 *     never moved or reset — it may hold the user's own commits.
 *   - The worktree is created at the standard `.worktrees/<feature>/`
 *     path. If a registered worktree already sits there on the same
 *     branch it is adopted; a foreign worktree/directory refuses.
 *   - The detached mirror is removed after a successful promotion by
 *     default — it's superseded by the editable worktree. Pass
 *     `{ removeMirror: false }` to keep the mirror on disk so the
 *     caller can update state.json BEFORE tearing it down.
 *
 * Throws TakeOverError with a user-facing message for expected
 * refusals (branch already checked out elsewhere, remote branch
 * deleted, path occupied); plain Error for git-infrastructure
 * failures.
 */
export async function takeOverRemoteWorktree(
  openspecDir: string,
  remoteRef: string,
  options?: TakeOverOptions,
): Promise<TakeOverResult> {
  const removeMirror = options?.removeMirror ?? true;
  const { branch } = parseRemoteRef(remoteRef);
  const remoteFull = `refs/remotes/origin/${branch}`;

  // The scan normally fetches the branch before we get here, but a
  // fresh clone / gc may have dropped the remote-tracking ref. Retry
  // the fetch once; a persistent miss means the author deleted the
  // branch upstream — nothing left to take over.
  let remoteTipExists = await refExists(openspecDir, remoteFull);
  if (!remoteTipExists) {
    try {
      await run(openspecDir, ["fetch", "origin", branch]);
    } catch {
      /* fallthrough — the verify below decides */
    }
    remoteTipExists = await refExists(openspecDir, remoteFull);
  }
  if (!remoteTipExists) {
    throw new TakeOverError(
      `Ветка "${branch}" не найдена в remote — забрать в работу нельзя`,
    );
  }

  // Create the local branch only when missing; never move an existing
  // one — it may already hold local commits from an earlier take-over.
  if (!(await refExists(openspecDir, `refs/heads/${branch}`))) {
    await run(openspecDir, ["branch", branch, remoteFull]);
  }

  const worktreePath = localWorktreePath(openspecDir, branch);

  if (await pathExists(worktreePath)) {
    if (!(await isRegisteredWorktree(openspecDir, worktreePath))) {
      throw new TakeOverError(
        `Путь занят посторонней директорией: ${worktreePath}`,
      );
    }
    const existingBranch = await worktreeBranch(worktreePath);
    if (existingBranch !== branch) {
      throw new TakeOverError(
        `Путь ${worktreePath} занят ворктреем на ветке "${existingBranch}"`,
      );
    }
    // A worktree on the target branch already exists (e.g. a previous
    // take-over whose state write was interrupted). Adopt it as-is.
    if (removeMirror) {
      await removeRemoteReadonlyWorktree(openspecDir, remoteRef);
    }
    return { worktreePath, branch, adoptedExisting: true };
  }

  try {
    await run(openspecDir, ["worktree", "add", worktreePath, branch]);
  } catch (e) {
    const msg = String((e as Error).message);
    if (
      msg.includes("already checked out") ||
      msg.includes("already used by worktree")
    ) {
      throw new TakeOverError(
        `Ветка "${branch}" уже используется другим ворктреем`,
      );
    }
    throw e;
  }

  if (removeMirror) {
    await removeRemoteReadonlyWorktree(openspecDir, remoteRef);
  }
  return { worktreePath, branch, adoptedExisting: false };
}