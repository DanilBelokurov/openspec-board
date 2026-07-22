import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";

/**
 * Return the two-step code-review-graph status for every configured
 * repo so the UI toaster (components/RepoBuildToaster.tsx) can
 * poll it cheaply. Each repo entry carries PIDs / startedAt /
 * exitCode / logPath for both the build and the visualize step.
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
    visualizePid: repo.visualizePid ?? null,
    visualizeStartedAt: repo.visualizeStartedAt ?? null,
    visualizeExitCode: repo.visualizeExitCode ?? null,
    visualizeLogPath: repo.visualizeLogPath ?? null,
  }));
  return NextResponse.json({ repos: out });
}