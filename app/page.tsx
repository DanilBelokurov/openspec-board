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
  type BoardItem,
} from "@/lib/openspec";

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
  const items: BoardItem[] = await Promise.all(
    Object.values(state.tasks)
      .filter((t) => mode.stages.includes(t.stage))
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
        // In analyst mode, "error" means either CLI step exited non-zero.
        // In developer mode, gigacodeExitCode tracks /opsx:plan (the only
        // background step), so including it is still correct there.
        const stepError =
          (t.openspecNewExitCode != null && t.openspecNewExitCode !== 0) ||
          (t.gigacodeContinueExitCode != null &&
            t.gigacodeContinueExitCode !== 0) ||
          (t.gigacodeExitCode != null && t.gigacodeExitCode !== 0);
        const jiraId = t.jiraUrl ? extractJiraId(t.jiraUrl) : null;
        return {
          ...t.summary,
          jiraUrl: t.jiraUrl,
          jiraId: jiraId ?? undefined,
          codeRepoPath: t.codeRepoPath,
          openspecNewStatus: processStatusFor(t.openspecNewPid),
          gigacodeContinueStatus: processStatusFor(t.gigacodeContinuePid),
          gigacodeStatus: processStatusFor(t.gigacodePid),
          proposalReady,
          gigacodeError: stepError || undefined,
        };
      }),
  );

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