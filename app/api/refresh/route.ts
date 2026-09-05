import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import {
  mergeDeveloperScan,
  mergeRemoteFeatureScan,
  readState,
  refreshAnalystTaskSummary,
  updateTask,
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
    // Per-mode refresh on ↻:
    //   - analyst:  metadata-only refresh for all LOCAL analyst
    //                tasks (re-reads proposal.md / design.md /
    //                specs/ on disk and patches summary.*).
    //                Plus a one-shot remote feature-branches scan
    //                independent of the watcher's cadence so the
    //                user can pull teammates' work on demand.
    //                No more "create-by-disk-discovery": new
    //                analyst tasks come from POST /api/changes or
    //                from mergeRemoteFeatureScan below; the old
    //                create-on-disk path produced inconsistent
    //                entries (key prefix disagreed with persisted
    //                mode) and has been retired.
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
    // Remote-scan counters — surfaced in the JSON response so
    // the UI can show "обнаружено 2 новых proposal'а от коллег"
    // after a manual refresh. `removed` counts tasks whose
    // upstream branch disappeared (author pushed --delete);
    // the watcher silently reaps them in the background but
    // the manual ↻ surfaces the count too.
    let remoteDiscovered = 0;
    let remoteUpdated = 0;
    let remoteRemoved = 0;
    // Analyst-metadata refresh counter — number of LOCAL analyst
    // tasks whose summary was patched by this pass. The previous
    // implementation reported the count of disk summaries found;
    // under the metadata-only model the equivalent signal is the
    // number of tasks actually touched.
    let refreshedCount = 0;

    if (config.mode === "developer") {
      const result = await mergeDeveloperScan(
        config.openspecDir,
        config.defaultBranch || "master",
      );
      scanned = result.scanned;
    } else {
      // Refresh summary fields (title, hasProposal, hasDesign,
      // hasSpecs, fileCount, totalSize, updatedAt) for each LOCAL
      // analyst task. Sequential rather than Promise.all because
      // several tasks typically share the same fs-root —
      // parallel scans would re-walk the same tree N times.
      // refreshAnalystTaskSummary already skips no-op writes, so
      // quiet boards do almost nothing per click.
      const preRefresh = await readState();
      for (const [key, task] of Object.entries(preRefresh.tasks)) {
        if (task.mode !== "analyst") continue;
        if (task.remote) continue;
        try {
          const patch = await refreshAnalystTaskSummary(
            task,
            config.openspecDir,
          );
          if (!patch) continue;
          if (!preRefresh.tasks[key]) continue;
          await updateTask(task.mode, task.summary.changeName, patch);
          refreshedCount++;
        } catch (e) {
          console.warn(
            `[refresh] meta refresh ${task.summary.changeName} failed:`,
            e,
          );
        }
      }
      scanned = refreshedCount;

      // Trigger /opsx-continue for any proposal-stage task whose
      // .openspec.yaml is on disk but proposal.md isn't yet.
      continued = await triggerContinueIfNeeded(config.openspecDir);

      // One-shot remote feature scan. Runs unconditionally on ↻
      // regardless of remoteScanIntervalMinutes — the manual
      // refresh IS the user saying "give me the latest now". The
      // watcher tick is what honors the cadence for background
      // scans.
      const remoteResult = await mergeRemoteFeatureScan(
        config.openspecDir,
      );
      remoteDiscovered = remoteResult.discovered;
      remoteUpdated = remoteResult.updated;
      remoteRemoved = remoteResult.removed;
    }

    const final = await readState();
    return NextResponse.json({
      scanned,
      total: Object.keys(final.tasks).length,
      continued,
      remoteDiscovered,
      remoteUpdated,
      remoteRemoved,
      tasks: Object.values(final.tasks),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Не удалось обновить: ${String(e)}` },
      { status: 500 },
    );
  }
}