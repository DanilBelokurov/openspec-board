import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";

/**
 * Return the code-review-graph build status for every configured
 * repo so the UI toaster (components/RepoBuildToaster.tsx) can
 * poll it cheaply. Each repo entry carries the PID the build
 * was spawned with, the timestamp it started, and the exit code
 * once the watcher has flipped it.
 */
export async function GET() {
  const config = await readConfig();
  const repos = config.repos ?? {};
  const out = Object.entries(repos).map(([name, repo]) => ({
    name,
    buildPid: repo.buildPid ?? null,
    buildStartedAt: repo.buildStartedAt ?? null,
    buildExitCode: repo.buildExitCode ?? null,
    buildLogPath: repo.buildLogPath ?? null,
  }));
  return NextResponse.json({ repos: out });
}