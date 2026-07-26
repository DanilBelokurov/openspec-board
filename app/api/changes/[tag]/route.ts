import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { readState, findTaskByTag } from "@/lib/state";
import { readChange, resolveProposalRootForTask } from "@/lib/openspec";

export async function GET(
  _req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "openspecDir not configured" },
      { status: 400 },
    );
  }
  try {
    // Both analyst and developer tasks target the same change folder
    // (`<openspecDir>/openspec/changes/<tag>/`). Prefer the mode
    // matching the current board.
    const state = await readState();
    const found = await findTaskByTag(params.tag, config.mode);
    const task = found?.task;
    const proposalRoot = task
      ? await resolveProposalRootForTask(task, config.openspecDir)
      : config.openspecDir;
    const change = await readChange(proposalRoot, params.tag);
    return NextResponse.json(change);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to read ${params.tag}: ${String(e)}` },
      { status: 500 },
    );
  }
}
