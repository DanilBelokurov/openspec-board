import { NextResponse } from "next/server";
import "@/lib/watcher"; // side-effect: ensures background polling is running
import { readConfig } from "@/lib/config";
import { scanChangeRoots } from "@/lib/openspec";
import {
  mergeScanWithState,
  mergeDeveloperScan,
  readState,
} from "@/lib/state";
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
    // Per-mode scan:
    //   - analyst:  local filesystem scan over the openspecDir
    //                plus every analyst-mode worktree, same as
    //                before. The task content comes from the
    //                proposal.md / specs / design.md / adr.md
    //                files on disk.
    //   - developer: git-tracked-branch scan over the
    //                `config.defaultBranch` of the openspecDir
    //                remote. Each change-proposal that appears
    //                on that branch (i.e. was merged via PR
    //                upstream) becomes a backlog task here. The
    //                SHA of the merge commit is captured so the
    //                detail page can link to it.
    let scanned = 0;
    let total = 0;
    let continued: string[] = [];

    if (config.mode === "developer") {
      const result = await mergeDeveloperScan(
        config.openspecDir,
        config.defaultBranch || "master",
      );
      scanned = result.scanned;
    } else {
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
      continued = await triggerContinueIfNeeded(config.openspecDir);

      scanned = summaries.length;
    }

    const final = await readState();
    return NextResponse.json({
      scanned,
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