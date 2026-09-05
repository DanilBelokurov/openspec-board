import path from "path";

/**
 * Pure path utility — safe to import from client components
 * (no fs/child_process/exec deps).
 */
export function repoBasename(p: string): string {
  return path.basename(p.replace(/\/+$/, ""));
}