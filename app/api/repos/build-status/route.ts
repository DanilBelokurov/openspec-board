import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";

/**
 * Return the two-step code-review-graph status for every configured
 * repo so the UI toaster (components/RepoBuildToaster.tsx) can
 * poll it cheaply. Each repo entry carries PIDs / startedAt /
 * exitCode / logPath for both the build and the wiki step.
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
    buildError: repo.buildError ?? null,
    wikiPid: repo.wikiPid ?? null,
    wikiStartedAt: repo.wikiStartedAt ?? null,
    wikiExitCode: repo.wikiExitCode ?? null,
    wikiLogPath: repo.wikiLogPath ?? null,
    wikiError: repo.wikiError ?? null,
  }));
  return NextResponse.json({ repos: out });
}
