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

export type QwenStatus = "running" | "stopped" | "none";

export function qwenStatusFor(pid: number | null | undefined): QwenStatus {
  if (!pid) return "none";
  return isProcessAlive(pid) ? "running" : "stopped";
}