import path from "node:path";
import "@/lib/watcher"; // side-effect: starts background polling for /opsx-continue
import { TopBar } from "@/components/TopBar";
import { Board } from "@/components/Board";
import { readConfig } from "@/lib/config";
import { readState } from "@/lib/state";
import { triggerContinueIfNeeded } from "@/lib/continuation";
import { MODES } from "@/lib/modes";
import { processStatusFor } from "@/lib/process";
import { extractJiraId } from "@/lib/jira";
import {
  checkProposalExists,
  resolveProposalRootForTask,
  pipelineStatus,
  type BoardItem,
} from "@/lib/openspec";
import { isStageReady } from "@/lib/continuation";
import { isProcessAlive } from "@/lib/process";
import { listServicesInChange } from "@/lib/openspec-scanner";

export default async function Home() {
  const config = await readConfig();
  if (!config.openspecDir) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-surface">
        <TopBar mode={config.mode} />
        <main className="flex-1 overflow-hidden">
          <div className="flex h-full items-center justify-center text-[13px] text-slate-500">
            Укажите директорию OpenSpec store в настройках (⚙)
          </div>
        </main>
      </div>
    );
  }

  // Fire-and-forget on every board render (cheap when nothing to do;
  // becomes meaningful when a proposal task is waiting for /opsx-continue).
  await triggerContinueIfNeeded(config.openspecDir);

  const state = await readState();
  const mode = MODES[config.mode];

  // Build BoardItem for each task. proposalReady = does proposal.md exist?
  // Tasks created via the analyst-mode flow live on a dedicated worktree
  // (task.openspecWorktreePath) — that's where the proposal.md lands, not
  // in the main openspecDir. For tasks without a worktree, fall back
  // to openspecDir; for legacy tasks missing openspecWorktreePath,
  // resolveProposalRootForTask probes the on-disk convention.
  // This is a per-render disk check, but tasks are limited and the check is
  // a single fs.access so it's cheap enough for a scaffold.
  //
  // We return tuples { item, task } (not just BoardItem) so the
  // post-build filter can consult task.childTags / task.stage
  // without re-walking state. The filter hides the parent plan
  // task once every service under `<change>/tasks/` has a
  // child ("1a" rule), so the board only shows the children
  // in the develop column.
  const rawItems: Array<{ item: BoardItem; task: typeof state.tasks[string] }> =
    await Promise.all(
      Object.values(state.tasks)
        .filter((t) => t.mode === config.mode)
        .map(async (t) => {
          const proposalRoot = await resolveProposalRootForTask(
            t,
            config.openspecDir!,
          );
          const changePath = path.join(
            proposalRoot,
            "openspec",
            "changes",
            t.summary.changeName,
          );
          const proposalReady = await checkProposalExists(changePath);
          const deltaSpecReady = await isStageReady(
            proposalRoot,
            t.summary.changeName,
            {
              stage: "delta-spec",
              instructionsArtifact: "specs",
              artifactSubpath: "specs",
            },
          );
          const designReady = await isStageReady(
            proposalRoot,
            t.summary.changeName,
            {
              stage: "design",
              instructionsArtifact: "design",
              artifactSubpath: "design.md",
            },
          );
          const adrReady = await isStageReady(
            proposalRoot,
            t.summary.changeName,
            {
              stage: "adr",
              instructionsArtifact: "adr",
              artifactSubpath: "adr.md",
            },
          );
          const stepError =
            (t.openspecNewExitCode != null && t.openspecNewExitCode !== 0) ||
            (t.gigacodeContinueExitCode != null &&
              t.gigacodeContinueExitCode !== 0) ||
            (t.gigacodeExitCode != null && t.gigacodeExitCode !== 0);
          const deltaSpecCreateError =
            t.deltaSpecCreateExitCode != null &&
            t.deltaSpecCreateExitCode !== 0;
          const designCreateError =
            t.designCreateExitCode != null && t.designCreateExitCode !== 0;
          const adrCreateError =
            t.adrCreateExitCode != null && t.adrCreateExitCode !== 0;
          const jiraId = t.jiraUrl ? extractJiraId(t.jiraUrl) : null;
          const item: BoardItem = {
            ...t.summary,
            jiraUrl: t.jiraUrl,
            jiraId: jiraId ?? undefined,
            codeRepoPath: t.codeRepoPath,
            openspecNewStatus: processStatusFor(t.openspecNewPid),
            gigacodeContinueStatus: processStatusFor(t.gigacodeContinuePid),
            deltaSpecCreateStatus: processStatusFor(t.deltaSpecCreatePid),
            designCreateStatus: processStatusFor(t.designCreatePid),
            adrCreateStatus: processStatusFor(t.adrCreatePid),
            gigacodeStatus: processStatusFor(t.gigacodePid),
            proposalReady,
            deltaSpecReady,
            designReady,
            adrReady,
            gigacodeError: stepError || undefined,
            deltaSpecCreateError: deltaSpecCreateError || undefined,
            designCreateError: designCreateError || undefined,
            adrCreateError: adrCreateError || undefined,
            archived: t.archived || undefined,
            codeBaseSha: t.codeBaseSha,
            pipelineStatus: pipelineStatus(
              t,
              (pid) => isProcessAlive(pid),
              t.stage === "proposal"
                ? proposalReady
                : t.stage === "delta-spec"
                  ? deltaSpecReady
                  : t.stage === "design"
                    ? designReady
                    : t.stage === "adr"
                      ? adrReady
                      : false,
            ),
          };
          return { item, task: t };
        }),
    );

  // Per the "1a" rule, hide a plan-stage parent from the
  // board once every service under `<change>/tasks/` has
  // a child. The children continue to show in the develop
  // column. We re-scan the change folder for plan-stage
  // tasks with at least one childTag (cheap: a single
  // readdir on tasks/, no recursive walk).
  const items: BoardItem[] = [];
  for (const { item, task } of rawItems) {
    if (
      task.stage === "plan" &&
      task.mode === "developer" &&
      task.childTags &&
      task.childTags.length > 0 &&
      task.openspecWorktreePath
    ) {
      const services = await listServicesInChange(
        task.openspecWorktreePath,
        task.summary.changeName,
      );
      if (services.length > 0 && task.childTags.length >= services.length) {
        // Every service has a child — parent is no longer
        // actionable, hide from the board.
        continue;
      }
    }
    items.push(item);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <TopBar mode={config.mode} />
      <main className="flex-1 overflow-hidden">
        <Board
          items={items}
          stages={mode.stages}
          meta={mode.meta}
          mode={config.mode}
        />
      </main>
    </div>
  );
}