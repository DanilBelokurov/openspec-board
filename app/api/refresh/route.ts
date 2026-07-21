import { NextResponse } from "next/server";
import "@/lib/watcher"; // side-effect: ensures background polling is running
import { readConfig } from "@/lib/config";
import { scanChangeRoots } from "@/lib/openspec";
import { mergeScanWithState, readState } from "@/lib/state";
import { triggerContinueIfNeeded } from "@/lib/continuation";

export async function POST() {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Сначала укажите директорию OpenSpec store в настройках" },
      { status: 400 },
    );
  }

  try {
    // Build the list of roots to scan:
    //   1. The main openspecDir (legacy / non-worktree changes, plus any
    //      unmerged feature work that has been pushed/merged).
    //   2. Every task's openspecWorktreePath (analyst-mode flow — that's
    //      where proposal.md / specs / design.md actually live).
    // Order matters: scanChangeRoots makes LATER roots win on
    // changeName collisions, so we put the main repo FIRST and
    // worktrees SECOND. Worktrees always reflect the most recent state.
    const state = await readState();
    const roots = new Set<string>([config.openspecDir]);
    for (const task of Object.values(state.tasks)) {
      if (task.openspecWorktreePath) roots.add(task.openspecWorktreePath);
    }
    const rootList = Array.from(roots);

    const summaries = await scanChangeRoots(rootList);
    await mergeScanWithState(summaries);

    // Also trigger /opsx-continue for any proposal-stage task whose
    // .openspec.yaml is on disk but proposal.md isn't yet.
    // (Same trigger also runs from server components on every page load,
    // so this is mostly belt-and-braces for the explicit refresh case.)
    const continued = await triggerContinueIfNeeded(config.openspecDir);

    // Re-read after the continue-trigger updates may have written changes.
    const final = await mergeScanWithState(await scanChangeRoots(rootList));

    return NextResponse.json({
      scanned: summaries.length,
      total: Object.keys(final.tasks).length,
      continued,
      tasks: Object.values(final.tasks),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Не удалось обновить: ${String(e)}` },
      { status: 500 },
    );
  }
}