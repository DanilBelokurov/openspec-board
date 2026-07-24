import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { ChangeSummary, Stage } from "./openspec";
import { MODES, type BoardModeId } from "./modes";

const STATE_DIR = path.join(process.cwd(), ".sdd-board");
const STATE_FILE = path.join(STATE_DIR, "state.json");

/**
 * The mode the task was created in. Tasks live in exactly one
 * mode — analyst (proposal / specs / design / ADR) or developer
 * (start / implement / test / deploy). The 'done' stage exists
 * in both modes' stage lists, so without this field a
 * finished-analyst task would show up in the developer board too.
 * We infer it from the stage for legacy entries that don't have
 * the field set.
 */
export type TaskMode = BoardModeId;

export interface TaskEntry {
  id: string;
  /**
   * Which board mode this task belongs to. Set on creation; never
   * changes. Defaults to "developer" for legacy state.json entries
   * that predate this field.
   */
  mode: TaskMode;
  stage: Stage;
  lastScannedAt: string;
  summary: ChangeSummary;
  // Set after "Start" action (developer mode).
  jiraUrl?: string;
  codeRepoPath?: string;
  openspecWorktreePath?: string;
  codeWorktreePath?: string;
  // PID of the gigacode /opsx:plan process spawned by the Start action
  // (developer mode). Distinct from the analyst-mode proposal-creation
  // step PIDs below.
  gigacodePid?: number | null;
  gigacodeExitCode?: number | null;
  gigacodeExitSignal?: string | null;
  gigacodeLogPath?: string;
  startedAt?: string;
  // First proposal-creation step (analyst mode) — the openspec CLI
  // (`openspec new change <tag>`). Creates the change directory and the
  // .openspec.yaml metadata file.
  description?: string;
  // The proposal's tag is the change folder name, exposed externally as
  // summary.changeName (OpenSpec's term for the change identifier). It is
  // intentionally NOT a separate field on TaskEntry — keep one source of
  // truth for "the change identifier" (used as state key, folder, log
  // filename, URL segment, and CLI command argument).
  openspecNewPid?: number | null;
  openspecNewStartedAt?: string;
  openspecNewExitCode?: number | null;
  openspecNewExitSignal?: string | null;
  openspecNewLogPath?: string;
  // Pre-step: index refresh of the openspec-store git tree,
  // running BEFORE openspec new change so the gigacode agent
  // that writes proposal.md has a fresh code-review-graph
  // to consult. Spawned as a detached gigacode process that
  // drives mcp__code-review-graph__build_or_update_graph_tool
  // + mcp__code-review-graph__get_architecture_overview_tool,
  // exactly like the per-repo build-graph pipeline but pointed
  // at the openspec store rather than a user-added submodule.
  indexRefreshPid?: number | null;
  indexRefreshStartedAt?: string;
  indexRefreshExitCode?: number | null;
  indexRefreshExitSignal?: string | null;
  indexRefreshLogPath?: string;
  // Second proposal-creation step (analyst mode) — gigacode /opsx-continue,
  // auto-triggered from lib/continuation.ts once the change directory and
  // .openspec.yaml exist but proposal.md does not.
  gigacodeContinuePid?: number | null;
  gigacodeContinueStartedAt?: string;
  gigacodeContinueExitCode?: number | null;
  gigacodeContinueExitSignal?: string | null;
  gigacodeContinueLogPath?: string;
  // Third proposal-creation step (analyst mode) — synchronous `git add`
  // + `git commit` on the feature branch, auto-triggered once proposal.md
  // exists on disk. Idempotent via `committedAt` (set on success).
  committedAt?: string;
  commitExitCode?: number | null;
  commitError?: string;
  // Proposal update step — analyst-initiated re-run that folds a
  // free-form request into the gigacode --prompt and rewrites the
  // existing proposal.md. Spawned by the pencil-button on
  // ConfirmButton; not auto-triggered. Idempotent via
  // proposalUpdatePid — a live PID blocks a second spawn until it
  // exits.
  proposalUpdatePid?: number | null;
  proposalUpdateStartedAt?: string;
  proposalUpdateExitCode?: number | null;
  proposalUpdateExitSignal?: string | null;
  proposalUpdateLogPath?: string;
  proposalUpdateComments?: string;
  // delta-spec (analyst-mode) step: openspec instructions specs →
  // gigacode --prompt → write <change>/specs/<capability>.md. Mirror
  // of the proposal* fields, separate from them so both stages can
  // be in flight / completed / committed independently.
  deltaSpecCreatePid?: number | null;
  deltaSpecCreateStartedAt?: string;
  deltaSpecCreateExitCode?: number | null;
  deltaSpecCreateExitSignal?: string | null;
  deltaSpecCreateLogPath?: string;
  deltaSpecUpdatePid?: number | null;
  deltaSpecUpdateStartedAt?: string;
  deltaSpecUpdateExitCode?: number | null;
  deltaSpecUpdateExitSignal?: string | null;
  deltaSpecUpdateLogPath?: string;
  deltaSpecUpdateComments?: string;
  deltaSpecCommittedAt?: string;
  deltaSpecCommitExitCode?: number | null;
  deltaSpecCommitError?: string;
  // design (analyst-mode) step: openspec instructions design →
  // gigacode --prompt → write <change>/design.md. Mirror of the
  // proposal* / deltaSpec* fields; same chaining rules.
  designCreatePid?: number | null;
  designCreateStartedAt?: string;
  designCreateExitCode?: number | null;
  designCreateExitSignal?: string | null;
  designCreateLogPath?: string;
  designUpdatePid?: number | null;
  designUpdateStartedAt?: string;
  designUpdateExitCode?: number | null;
  designUpdateExitSignal?: string | null;
  designUpdateLogPath?: string;
  designUpdateComments?: string;
  designCommittedAt?: string;
  designCommitExitCode?: number | null;
  designCommitError?: string;
  // adr (analyst-mode) step: openspec instructions adr →
  // gigacode --prompt → write <change>/docs/adr/<id>-<title>.md.
  // Mirror of the proposal* / deltaSpec* / design* fields.
  adrCreatePid?: number | null;
  adrCreateStartedAt?: string;
  adrCreateExitCode?: number | null;
  adrCreateExitSignal?: string | null;
  adrCreateLogPath?: string;
  adrUpdatePid?: number | null;
  adrUpdateStartedAt?: string;
  adrUpdateExitCode?: number | null;
  adrUpdateExitSignal?: string | null;
  adrUpdateLogPath?: string;
  adrUpdateComments?: string;
  adrCommittedAt?: string;
  adrCommitExitCode?: number | null;
  adrCommitError?: string;
  // 'Опубликовать ветку' / 'Сделать pull request' actions on the
  // done stage (analyst mode only). The push is a one-shot
  // git operation; pushedAt is set on success. The PR is a
  // detached gigacode --prompt run that reads
  // templates/git/create-pull-request-template.md.
  pushedAt?: string;
  pushPid?: number | null;
  pushStartedAt?: string;
  pushExitCode?: number | null;
  pushExitSignal?: string | null;
  pushLogPath?: string;
  pushError?: string;
  pushRemoteUrl?: string;
  pullRequestPid?: number | null;
  pullRequestStartedAt?: string;
  pullRequestExitCode?: number | null;
  pullRequestExitSignal?: string | null;
  pullRequestLogPath?: string;
  pullRequestError?: string;
  pullRequestUrl?: string;
  // Developer-mode backlog scan. Set when the task was created
  // (or refreshed) from a change-proposal on
  // config.defaultBranch of the sdd-store remote. The SHA is
  // the commit on the tracked branch where the change lives;
  // surfacing it in the UI lets the dev jump straight to the
  // merged commit on GitHub.
  codeBranch?: string;
  codeBaseSha?: string;
  // `true` when the change-proposal has been moved to
  // openspec/changes/archive/ upstream. Tasks in `backlog` are
  // removed outright; tasks in any other stage get a red
  // "архив" badge and stay on the board for the dev to close
  // manually.
  archived?: boolean;
}

export interface AppState {
  tasks: Record<string, TaskEntry>;
}

/**
 * For tasks predating the `mode` field, infer it from the current
 * stage. Stages that exist only in the analyst stages list map
 * to "analyst"; everything else maps to "developer". "done" is
 * ambiguous (both modes have it) — we break the tie by defaulting
 * to "developer" since older entries are most likely developer
 * tasks that finished before the analyst flow existed.
 */
function inferModeFromStage(stage: Stage): TaskMode {
  if (MODES.analyst.stages.includes(stage)) return "analyst";
  return "developer";
}

const EMPTY_STATE: AppState = { tasks: {} };

export async function readState(): Promise<AppState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const tasks = parsed.tasks ?? {};
    // In-memory only: keep summary.stage in lockstep with task.stage
    // for tasks where they drifted (typically after a confirm before
    // updateTask started syncing them). The board reads BoardItem.stage
    // from summary.stage; without this the task stays visually stuck
    // in its old column. The next writeState call (from updateTask or
    // mergeScanWithState) persists the corrected value.
    for (const task of Object.values(tasks)) {
      if (task.summary.stage !== task.stage) {
        task.summary = { ...task.summary, stage: task.stage };
      }
      // Backfill the mode field for legacy entries that predate it.
      // We don't persist the inferred mode here — it'll be written
      // back on the next updateTask / mergeScanWithState call.
      // For other tasks this is a no-op.
      if (task.mode == null) {
        task.mode = inferModeFromStage(task.stage);
      }
    }
    return { tasks };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return EMPTY_STATE;
    throw e;
  }
}

export async function writeState(state: AppState): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(
    STATE_FILE,
    JSON.stringify(state, null, 2) + "\n",
    "utf-8",
  );
}

function nextTaskId(_existing: Map<string, TaskEntry>): string {
  return randomUUID();
}

export async function mergeScanWithState(
  summaries: ChangeSummary[],
): Promise<AppState> {
  const state = await readState();
  const tasks = new Map<string, TaskEntry>(Object.entries(state.tasks));
  const now = new Date().toISOString();

  for (const summary of summaries) {
    const prev = tasks.get(summary.changeName);
    if (prev) {
      tasks.set(summary.changeName, {
        ...prev,
        lastScannedAt: now,
        summary: { ...summary, id: prev.id, stage: prev.stage },
      });
    } else {
      const id = nextTaskId(tasks);
      // A task discovered purely from disk (no prior state entry)
      // is most likely a developer-mode task — change-proposals
      // created through the API always have an explicit mode set,
      // and the openspec change-folder layout doesn't collide
      // with the developer-mode <repo>/changes/ layout we use.
      // If we ever support discovery-driven analyst tasks, the
      // mode can be flipped here.
      const mode: TaskMode = inferModeFromStage("backlog");
      tasks.set(summary.changeName, {
        id,
        mode,
        stage: "backlog",
        lastScannedAt: now,
        summary: { ...summary, id, stage: "backlog" },
      });
    }
  }

  const merged: AppState = { tasks: Object.fromEntries(tasks) };
  await writeState(merged);
  return merged;
}

/**
 * Developer-mode scan: walk `openspecDir`'s `config.defaultBranch`
 * via `scanChangeProposalsOnBranch`, then merge the result into
 * `state.tasks`:
 *
 *   - Live change-proposal  → new task in `backlog` (or update
 *     the existing one with the new title / description /
 *     codeBaseSha).
 *   - Archived change-proposal that's no longer live →
 *     `archived: true` on the existing task. The dev's task
 *     stays in whatever stage it was at; the red "архив" badge
 *     will appear on the card so they know to close it.
 *   - Archived change-proposal whose existing task is in
 *     `backlog` → task removed outright (the dev workflow
 *     never picked it up).
 *   - A task that has neither live nor archived proposal
 *     upstream is left alone — it might be an old local task
 *     the dev is still working on, or one whose remote we
 *     couldn't see.
 */
export async function mergeDeveloperScan(
  openspecDir: string,
  branch: string,
): Promise<{ scanned: number; created: number; archived: number; removed: number }> {
  const { scanChangeProposalsOnBranch } = await import("./openspec-scanner");
  const proposals = await scanChangeProposalsOnBranch(
    openspecDir,
    branch,
  );
  const state = await readState();
  const tasks = new Map<string, TaskEntry>(Object.entries(state.tasks));
  const now = new Date().toISOString();

  const liveTags = new Set<string>();
  const archivedTags = new Set<string>();
  let liveByTag = new Map<string, (typeof proposals)[number]>();
  for (const p of proposals) {
    if (p.archived) archivedTags.add(p.tag);
    else {
      liveTags.add(p.tag);
      liveByTag.set(p.tag, p);
    }
  }

  let created = 0;
  let archived = 0;
  let removed = 0;

  for (const p of proposals) {
    const existing = tasks.get(p.tag);
    if (p.archived) {
      // Live + archived: change lives in both, treat as live.
      // (The dev can still pick it up — `git show origin/<branch>`
      // would resolve to the live copy.)
      if (liveTags.has(p.tag)) continue;
      if (!existing) continue; // not in our board yet
      tasks.set(p.tag, {
        ...existing,
        lastScannedAt: now,
        archived: true,
      });
      archived++;
      continue;
    }

    // Live proposal.
    if (existing) {
      // Preserve stage, mode, all dev-managed fields. Just
      // refresh the content + sha + archived flag.
      tasks.set(p.tag, {
        ...existing,
        lastScannedAt: now,
        archived: false,
        codeBranch: branch,
        codeBaseSha: p.sha,
        summary: {
          ...existing.summary,
          title: p.title,
          changeName: p.tag,
        },
        description: p.description,
        jiraUrl: p.jiraUrl ?? existing.jiraUrl,
      });
    } else {
      const id = randomUUID();
      tasks.set(p.tag, {
        id,
        mode: "developer",
        stage: "backlog",
        lastScannedAt: now,
        summary: {
          id,
          changeName: p.tag,
          path: "",
          title: p.title,
          stage: "backlog",
          hasProposal: true,
          hasDesign: false,
          hasSpecs: false,
          capabilityTags: [],
          newCapabilities: [],
          modifiedCapabilities: [],
          specCounts: { added: 0, modified: 0, removed: 0, scenarios: 0 },
          updatedAt: now,
          fileCount: 0,
          totalSize: 0,
        },
        description: p.description,
        jiraUrl: p.jiraUrl ?? undefined,
        codeBranch: branch,
        codeBaseSha: p.sha,
        archived: false,
      });
      created++;
    }
  }

  // Cleanup: tasks that no longer have a live proposal upstream
  // and have moved to archive. Backlog tasks are removed;
  // anything past backlog is flagged archived.
  for (const [tag, task] of Array.from(tasks.entries())) {
    if (task.mode !== "developer") continue;
    if (liveTags.has(tag)) continue; // still live
    if (!archivedTags.has(tag)) continue; // not archived upstream either
    if (task.stage === "backlog") {
      tasks.delete(tag);
      removed++;
    } else if (!task.archived) {
      tasks.set(tag, { ...task, lastScannedAt: now, archived: true });
      archived++;
    }
  }

  await writeState({ tasks: Object.fromEntries(tasks) });
  return { scanned: proposals.length, created, archived, removed };
}

export async function updateTask(
  changeName: string,
  patch: Partial<TaskEntry>,
): Promise<TaskEntry | null> {
  const state = await readState();
  const existing = state.tasks[changeName];
  if (!existing) return null;
  const updated: TaskEntry = { ...existing, ...patch };
  // Keep `summary.stage` in lockstep with `task.stage` — the board
  // reads `BoardItem.stage` from `summary.stage`, not `task.stage`,
  // so a stage-only patch would otherwise leave the task visually
  // stuck in its old column after a successful confirm.
  if (patch.stage !== undefined) {
    updated.summary = { ...updated.summary, stage: patch.stage };
  }
  state.tasks[changeName] = updated;
  await writeState(state);
  return updated;
}