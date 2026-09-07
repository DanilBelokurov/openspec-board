import { NextResponse } from "next/server";
import { readUekExpertState } from "@/lib/uek-expert/state";

/**
 * Return the last persisted snapshot of UEK-expert pull requests.
 * Read-only — the scan endpoint is the only writer.
 */
export async function GET() {
  const state = await readUekExpertState();
  return NextResponse.json({
    pullRequests: state.pullRequests,
    lastScannedAt: state.lastScannedAt,
    lastScanError: state.lastScanError,
  });
}
