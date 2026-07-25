/**
 * Spawn `git push` for the feature branch that backs an
 * analyst-mode task. Detached, with stdout/stderr redirected to
 * .sdd-board/logs/<tag>.push.log so the user can inspect the
 * output. The watcher in lib/watcher.ts polls the PID and writes
 * pushExitCode back to state.
 */

import { spawnDetachedWithLog, ensureLogDir } from "./process-logger";

function ensureRepoLogDir(): Promise<void> {
  return ensureLogDir().then(() => Promise.resolve());
}

export interface PushResult {
  pid: number | null;
  logFile: string;
  error?: string;
}

export function spawnGitPush(
  worktree: string,
  branch: string,
  tag: string,
): PushResult {
  // Same ensureRepoLogDir dance as the code-review-graph
  // spawners — .sdd-board/logs/repos/ is one level deeper than
  // what process-logger's ensureLogDir creates.
  void ensureRepoLogDir();
  const logFile = `.sdd-board/logs/repos/${tag}.push.log`;
  try {
    const result = spawnDetachedWithLog({
      command: "git",
      argv: ["-C", worktree, "push", "-u", "origin", branch],
      logFile,
      header: `git push origin ${branch} for ${tag}`,
      cwd: worktree,
    });
    return { pid: result.pid || null, logFile };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`git push spawn threw:`, message);
    return { pid: null, logFile, error: message };
  }
}

/**
 * Follow-up push after the branch has already been published once
 * via `spawnGitPush`. Tracking is set up, so we just run a plain
 * `git push origin <branch>` — fast-forwards origin if the local
 * branch is ahead, prints "Everything up-to-date" if it isn't.
 * The existing PR on GitHub/GitLab picks up the new commits
 * automatically via branch tracking.
 *
 * Used by the «Обновить ветку» button on the done stage when
 * the analyst re-confirms after a reopen and the local branch
 * has new commits that the existing PR should reflect.
 *
 * Logs go to a separate file (`.update.log` instead of `.push.log`)
 * so the first push and subsequent updates stay independently
 * readable. The watcher's push-completion branch treats any live
 * pushPid uniformly — it flips pushExitCode = 0 and updates
 * pushedAt — so no watcher change is needed for this entry point.
 */
export function spawnGitPushUpdate(
  worktree: string,
  branch: string,
  tag: string,
): PushResult {
  void ensureRepoLogDir();
  const logFile = `.sdd-board/logs/repos/${tag}.update.log`;
  try {
    const result = spawnDetachedWithLog({
      command: "git",
      argv: ["-C", worktree, "push", "origin", branch],
      logFile,
      header: `git push origin ${branch} (update) for ${tag}`,
      cwd: worktree,
    });
    return { pid: result.pid || null, logFile };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`git push update spawn threw:`, message);
    return { pid: null, logFile, error: message };
  }
}