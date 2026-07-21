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