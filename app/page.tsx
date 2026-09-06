import path from "node:path";
// The watcher is normally started by instrumentation.ts at server
// boot. This import is a fallback for environments where the
// instrumentation hook is not wired (e.g. a custom server entry
// that bypasses Next.js's startup hook) — the globalThis guard
// inside lib/watcher.ts makes the start idempotent so a second
// caller in the same process is a no-op.
import "@/lib/watcher";
import { TopBar } from "@/components/TopBar";
import { Board } from "@/components/Board";
import { UekReviewBoard } from "@/components/UekReviewBoard";
import { readConfig } from "@/lib/config";
import { readState } from "@/lib/state";
import { triggerContinueIfNeeded } from "@/lib/continuation";
import { MODES } from "@/lib/modes";
import { processStatusFor } from "@/lib/process";
import { extractJiraId } from "@/lib/jira";
import {
  checkProposalExists,
  resolveArtifactSource,
  checkProposalExistsFromGit,
  isStageReadyFromGit,
  pipelineStatus,
  type BoardItem,
} from "@/lib/openspec";
import { isStageReady } from "@/lib/continuation";
import { isProcessAlive } from "@/lib/process";
import { listServicesInChange } from "@/lib/openspec-scanner";

export default async function Home({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const config = await readConfig();
  // The openspec store directory is required only for the
  // openspec-aware modes (developer / analyst). The UEK-expert
  // mode renders the review board, which doesn't read or write
  // anything under `<openspecDir>`, so the "specify the
  // directory" prompt shouldn't appear there.
  if (config.mode !== "uek-expert" && !config.openspecDir) {
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
  // Author filter — server-side, keyed off URL param so the
  // choice survives a page refresh and the link is
  // shareable. Three values:
  //
  //   "mine"   → only local tasks (remote tasks are hidden)
  //   "others" → only remote tasks where publishedBy.email
  //              doesn't match the configured user
  //   anything else (default, including "all" / undefined /
  //   garbage) → no filter, show everything
  //
  // The filter requires a configured user.email; without it
  // the toggle degrades gracefully to "all" and the UI hides
  // the filter control entirely.
  const authorParam = searchParams?.author;
  const authorFilter: "mine" | "others" | "all" =
    authorParam === "mine"
      ? "mine"
      : authorParam === "others"
        ? "others"
        : "all";
  const myEmail = config.user?.email?.toLowerCase();

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
  // Remote tasks (published by another user, no local worktree) have
  // their readiness flags read from git at sourceCommit instead.
  // resolveArtifactSource decides which path a task takes.
  // This is a per-render disk/git check, but tasks are limited and the
  // check is cheap enough for a scaffold.
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
          const source = await resolveArtifactSource(t, config.openspecDir!);
          // Remote tasks (published by another user) have no on-disk
          // worktree: readiness flags come from git at sourceCommit.
          const gitSource = source.kind === "git" ? source : null;
          const proposalRoot =
            source.kind === "git" ? null : source.root;
          const changePath = proposalRoot
            ? path.join(
                proposalRoot,
                "openspec",
                "changes",
                t.summary.changeName,
              )
            : null;
          const proposalReady = gitSource
            ? await checkProposalExistsFromGit(
                gitSource.repoDir,
                gitSource.ref,
                gitSource.changeName,
              )
            : await checkProposalExists(changePath!);
          const deltaSpecReady = gitSource
            ? await isStageReadyFromGit(
                gitSource.repoDir,
                gitSource.ref,
                gitSource.changeName,
                "specs",
              )
            : await isStageReady(
                proposalRoot!,
                t.summary.changeName,
                {
                  stage: "delta-spec",
                  instructionsArtifact: "specs",
                  artifactSubpath: "specs",
                },
              );
          const designReady = gitSource
            ? await isStageReadyFromGit(
                gitSource.repoDir,
                gitSource.ref,
                gitSource.changeName,
                "design.md",
              )
            : await isStageReady(
                proposalRoot!,
                t.summary.changeName,
                {
                  stage: "design",
                  instructionsArtifact: "design",
                  artifactSubpath: "design.md",
                },
              );
          const adrReady = gitSource
            ? await isStageReadyFromGit(
                gitSource.repoDir,
                gitSource.ref,
                gitSource.changeName,
                "adr.md",
              )
            : await isStageReady(
                proposalRoot!,
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
            parentTag: t.parentTag,
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
            // Multi-user read-only task metadata. Forwarded
            // as-is from the persisted TaskEntry so SessionCard
            // can render the author badge and "open on forge"
            // link without re-reading state.json on the client.
            // Locally-created tasks leave these undefined.
            publishedBy: t.publishedBy,
            remoteBranch: t.remoteBranch,
            sourceCommit: t.sourceCommit,
            remote: t.remote,
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
  const postPlanItems: BoardItem[] = [];
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
    postPlanItems.push(item);
  }

  // Author filter — applied LAST, after the plan-rule filter,
  // so the toggle in the TopBar operates on the same set the
  // user would otherwise see. `myEmail` is lowercased once
  // and compared against lowercased `publishedBy.email`; tasks
  // without a publishedBy (every local task and remote tasks
  // authored anonymously) match the "others" branch by
  // default — the user wouldn't expect their own locally-
  // authored work to vanish behind a "Мои" filter.
  const items: BoardItem[] =
    authorFilter === "all" || !myEmail
      ? postPlanItems
      : authorFilter === "mine"
        ? postPlanItems.filter((it) => {
            // Local tasks always pass — they're "mine" by
            // definition (the dev workflow doesn't track
            // authorship, so we don't second-guess it).
            if (!it.remote) return true;
            // Remote tasks: only if the tip author matches
            // the configured email.
            return it.publishedBy?.email?.toLowerCase() === myEmail;
          })
        : postPlanItems.filter((it) => {
            // "Чужие" — only remote tasks by a different
            // author. Local tasks are always "ours".
            if (!it.remote) return false;
            return it.publishedBy?.email?.toLowerCase() !== myEmail;
          });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <TopBar
        mode={config.mode}
        authorFilter={authorFilter}
        hasUserEmail={Boolean(myEmail)}
      />
      <main className="flex-1 overflow-hidden">
        {config.mode === "uek-expert" ? (
          <UekReviewBoard />
        ) : (
          <Board
            items={items}
            stages={mode.stages}
            meta={mode.meta}
            mode={config.mode}
          />
        )}
      </main>
    </div>
  );
}