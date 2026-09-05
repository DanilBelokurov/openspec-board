export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // signal 0 doesn't kill — just checks if the process exists and we can signal it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Generic process status — used for both the openspec CLI run that creates
// the change directory and the gigacode run that continues with proposal.md.
export type ProcessStatus = "running" | "stopped" | "none";

export function processStatusFor(
  pid: number | null | undefined,
): ProcessStatus {
  if (!pid) return "none";
  return isProcessAlive(pid) ? "running" : "stopped";
}

/**
 * Best-effort SIGTERM. Mirrors the killPid helper in
 * `lib/git-submodule.ts`: ESRCH (no such process) is treated as
 * success because the process already exited on its own, which
 * is exactly what we wanted. EPERM (not our process) is reported
 * as a skipped outcome so the caller can surface it; any other
 * error is also reported.
 */
export type KillOutcome = "killed" | "already-gone" | "skipped";

export function killProcess(pid: number | null | undefined): KillOutcome {
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
 * Wait until `pid` is no longer alive, polling every 100 ms
 * for up to `timeoutMs`. Returns true if the process exited
 * within the budget, false on timeout. Used by destructive
 * flows (delete task, kill daemon) so they don't race an
 * in-flight child that still holds files in a worktree.
 */
export async function waitForProcessExit(
  pid: number | null | undefined,
  timeoutMs = 3000,
): Promise<boolean> {
  if (pid == null || !Number.isInteger(pid) || pid <= 0) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !isProcessAlive(pid);
}

/**
 * SIGTERM a PID, wait briefly for it to exit, then SIGKILL
 * if it ignored the SIGTERM. Returns the final outcome so the
 * caller can report it in actions / logs. Use this before
 * removing a worktree so an active child doesn't race the rm.
 */
export async function terminateProcess(
  pid: number | null | undefined,
  options: { timeoutMs?: number } = {},
): Promise<KillOutcome> {
  const first = killProcess(pid);
  if (first === "skipped" || first === "already-gone") return first;
  const exited = await waitForProcessExit(pid, options.timeoutMs ?? 3000);
  if (exited) return first;
  try {
    process.kill(pid as number, "SIGKILL");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ESRCH") return "skipped";
  }
  await waitForProcessExit(pid, 1000);
  return "killed";
}