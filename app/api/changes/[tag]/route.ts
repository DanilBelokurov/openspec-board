import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { readState } from "@/lib/state";
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
    // Analyst-mode tasks live on a dedicated worktree; use that as the
    // proposal root so readChange looks there first. The helper also
    // falls back to the on-disk worktree convention if the task's
    // openspecWorktreePath field is missing (legacy / pre-fix state).
    const state = await readState();
    const task = state.tasks[params.tag];
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
