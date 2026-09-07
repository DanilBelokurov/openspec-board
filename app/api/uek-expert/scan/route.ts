import { NextResponse } from "next/server";
import { scanUekPullRequests } from "@/lib/uek-expert/scanner";
import { readConfig } from "@/lib/config";

/**
 * Synchronously trigger a UEK-expert scan. Used by:
 *   - the manual "Обновить" button in the UI
 *   - the periodic watcher tick
 *
 * The scan runs gigacode with the bitbucket list-my-pull-requests
 * template, parses the JSON it returns, and writes the merged
 * snapshot to `.sdd-board/uek-expert.json`.
 */
export async function POST() {
  const config = await readConfig();
  if (config.mode !== "uek-expert") {
    return NextResponse.json(
      { error: 'UEK-expert scan is only available in "uek-expert" mode' },
      { status: 400 },
    );
  }

  const result = await scanUekPullRequests();
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error ?? "scan failed",
        lastScannedAt: result.scannedAt,
      },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    scannedAt: result.scannedAt,
    fetched: result.fetched ?? 0,
    pullRequests: result.pullRequests,
  });
}
