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