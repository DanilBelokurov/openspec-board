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

export type GigacodeStatus = "running" | "stopped" | "none";

export function gigacodeStatusFor(pid: number | null | undefined): GigacodeStatus {
  if (!pid) return "none";
  return isProcessAlive(pid) ? "running" : "stopped";
}

export function gigacodeContinueStatusFor(
  pid: number | null | undefined,
): GigacodeStatus {
  if (!pid) return "none";
  return isProcessAlive(pid) ? "running" : "stopped";
}