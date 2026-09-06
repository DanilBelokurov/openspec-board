import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { ChangeSummary, Stage } from "./openspec";
import { MODES, type BoardModeId } from "./modes";
import { atomicWriteFile } from "./atomic-write";
import {
  ensureRemoteReadonlyWorktree,
  remoteWorktreeExists,
  removeRemoteReadonlyWorktree,
} from "./remote-worktree";
import { readStageFromOpenspecYaml } from "./openspec";
import { runExclusive } from "./async-lock";

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
/**
 * Which openspec-stage flow a task belongs to. The `uek-expert`
 * mode is a review board and does not own openspec tasks, so it is
 * intentionally absent from this union.
 */
export type TaskMode = Exclude<BoardModeId, "uek-expert">;

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
  // plan (developer-mode) step: openspec instructions tasks →
  // gigacode --prompt → write <change>/tasks.md. Mirror of the
  // analyst-mode design / adr fields. Idempotent via
  // planCreatePid — a live PID blocks a second spawn until it
  // exits.
  planCreatePid?: number | null;
  planCreateStartedAt?: string;
  planCreateExitCode?: number | null;
  planCreateExitSignal?: string | null;
  planCreateLogPath?: string;
  // Surface for `openspec instructions tasks` failing before
  // gigacode ever gets spawned. Separate from planCreateExitCode
  // (which is the gigacode exit). Mirrors what
  // proposal-commitError / deltaSpecCommitError do on the analyst
  // side, but scoped to the create step rather than the commit
  // step (there is no commit in the plan pipeline until the user
  // presses "Подтверждаю").
  planCreateError?: string;
  // plan (developer-mode) update step: same shape as
  // designUpdate* / adrUpdate*. Spawned by the pencil button on
  // ConfirmArtifactButton when the user re-runs the tasks.md
  // generation with a free-form request. Idempotent via
  // planUpdatePid — a live PID blocks a second spawn until it
  // exits. Routed through runUpdateArtifact with
  // { stage: "plan", instructionsArtifact: "tasks", artifactSubpath: "tasks.md" }.
  planUpdatePid?: number | null;
  planUpdateStartedAt?: string;
  planUpdateExitCode?: number | null;
  planUpdateExitSignal?: string | null;
  planUpdateLogPath?: string;
  planUpdateComments?: string;
  // Git commit recorded by /api/changes/<tag>/confirm when the
  // analyst presses "Подтверждаю" on the plan card. Mirrors the
  // per-stage committedAt / *CommitExitCode / *CommitError triple
  // used by the analyst flow.
  planCommittedAt?: string;
  planCommitExitCode?: number | null;
  planCommitError?: string;
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
  // Cascade-update flow (analyst mode). When the user clicks
  // «Редактировать» on a non-proposal stage and picks an earlier
  // target stage T, the task is moved to T, T's update is spawned
  // with the user's comment, and — on every subsequent confirm —
  // the next stage is *automatically* re-updated with the same
  // comment, until the task reaches `cascadeFromStage` (the stage
  // the user was on when they clicked «Редактировать»). This is
  // a single mechanism that works from any analyst stage
  // (including done); the UI is identical for from-done and
  // from-non-done. After cascade ends, ordinary pipeline resumes:
  // any artefact strictly past `cascadeFromStage` is left stale
  // and surfaced in the UI with a `(*)` marker so the user can
  // pencil-update or confirm-as-is. Manual pencil on any stage
  // implicitly cancels the cascade (clears the three fields
  // below). The cascade-update spawns reuse the existing
  // `*UpdatePid` fields — they are not separate from manual
  // pencil-updates, only triggered automatically.
  //
  // `cascadeTargetStage` is the lower bound of the cascade scope;
  // `cascadeFromStage` is the upper bound (inclusive). Cascade is
  // active while `cascadeTargetStage <= task.stage <=
  // cascadeFromStage && task.stage !== "done"`; cleared otherwise.
  cascadeTargetStage?: Stage;
  cascadeFromStage?: Stage;
  cascadeComment?: string;
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
  // Apply the `sdd` label to the linked Jira issue. Spawned by
  // the «Поставить sdd-метку» button on the done stage. The PR
  // gate (pullRequestExitCode === 0) lives in the API handler
  // and the spawner — these fields are only the persistence
  // shape (mirrors pullRequest* above).
  sddLabelPid?: number | null;
  sddLabelStartedAt?: string;
  sddLabelExitCode?: number | null;
  sddLabelExitSignal?: string | null;
  sddLabelLogPath?: string;
  sddLabelError?: string;
  sddLabelAppliedAt?: string;
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
  // Per-service child task graph (developer mode).
  // - parent tasks get `childTags`: the list of service
  //   names for which a child has been created. The board
  //   hides the parent once `childTags` covers every service
  //   listed under `<change>/tasks/`.
  // - parent tasks also get `serviceRepos`: the dev's last
  //   service → repoName selection, persisted by /confirm so
  //   a refresh of the plan page doesn't reset the dropdowns
  //   back to "skip".
  // - child tasks get `parentTag` (the parent's change-tag)
  //   and `serviceName` (the kebab-case directory name under
  //   `tasks/`). Children live in their own state entry
  //   (`developer:<service>`); the composite key plus the
  //   parentTag field is what links them back.
  childTags?: string[];
  serviceRepos?: Record<string, string>;
  parentTag?: string;
  serviceName?: string;
  // Multi-user read-only discovery: when another user publishes a
  // proposal on `feature/<JiraID>` and pushes it to origin, the
  // watcher periodically runs `scanRemoteFeatureBranches()` and
  // records the branch as a read-only task on the analyst board.
  // The user can READ proposal.md / specs / design.md / adr.md
  // from the remote-tracking ref but cannot edit locally — that's
  // deferred to the "track" flow (out of scope for the read-only
  // MVP). The five fields below carry everything the UI needs:
  //
  // - `publishedBy` — git author of the tip commit on the remote
  //   branch (`%an <%ae>`). Read at scan time, persisted to state
  //   so the card can render "от Alice" without re-running git on
  //   every render. Same identity convention as `git config
  //   user.email` is enforced via the SettingsDialog.
  // - `remoteBranch` — fully-qualified remote-tracking ref,
  //   e.g. "origin/feature/OKECS-13078". Used to render the link
  //   to the branch on the forge (Bitbucket/GitHub/etc.) via
  //   `buildBranchUrl`.
  // - `sourceCommit` — SHA of the tip commit we last read artifacts
  //   from. When this changes between scans (force-push upstream,
  //   new commits by the author) the merge-scan refreshes
  //   summary.{title,description} from the new SHA. Also used by
  //   the UI to show "обновлено в <sha>".
  // - `remote` — true when this task was discovered from a
  //   remote-tracking ref (i.e. belongs to someone else) and is
  //   not tracked locally via a worktree. False / unset for
  //   tasks created via POST /api/changes. Drives the "remote"
  //   badge on SessionCard and the "Мои / Чужие" filter.
  publishedBy?: {
    name: string;
    email: string;
  };
  remoteBranch?: string;
  sourceCommit?: string;
  remote?: boolean;

  // develop (developer-mode) TDD pipeline, split into two
  // human-gated phases per service. The dev can review the
  // tests RED wrote, approve them, and only then does GREEN
  // spawn to make those tests pass. The children inherit
  // `openspecWorktreePath` from the parent (where `tasks.md`
  // lives) and set their own `codeRepoPath` + `codeBranch`
  // (worktree on the chosen service repo).
  //
  // RED phase — `tdd-red-prompt-template.md`. Writes one
  // failing test per task in `tasks/<service>/tasks.md`,
  // commits each, returns. Does NOT write any production code.
  // `redPhaseBaseSha` is the worktree HEAD captured before
  // RED started so the test-diff endpoint can show
  // `git diff redPhaseBaseSha..HEAD` as the review artefact.
  redPhasePid?: number | null;
  redPhaseStartedAt?: string;
  redPhaseExitCode?: number | null;
  redPhaseExitSignal?: string | null;
  redPhaseLogPath?: string;
  redPhaseBaseSha?: string;
  redPhaseApprovedAt?: string;
  // RED tests are committed and pushed to the feature branch's
  // remote automatically by `commitAndPushRedTests` in
  // `lib/continuation.ts`, triggered from the RED exit handler
  // (and from the RED UPDATE pencil-flow exit handler). The user
  // reviews on GitHub; the diff view + commit-on-approve flow
  // used to live in our UI but was moved out of scope. `Подтвердить`
  // is now blocked until `redPhaseCommitSha` is set AND
  // `redPhasePushError` is null — per the agreed 2B contract.
  //   - `redPhaseCommitSha` is the SHA of the auto-commit (or
  //     unset if RED wrote nothing → skipped).
  //   - `redPhaseCommitError` is the stderr from the failed
  //     `git commit` (pre-commit hook, etc.). The user
  //     restarts RED on this case — `Подтвердить` is blocked.
  //   - `redPhasePushBranch` / `redPhasePushedAt` /
  //     `redPhasePushRemoteUrl` describe the successful push.
  //   - `redPhasePushError` is the stderr from the failed
  //     `git push` (auth, network, non-fast-forward). The user
  //     retries via `/implement/push`. `Подтвердить` is
  //     blocked until push succeeds.
  redPhaseCommitSha?: string;
  redPhaseCommitError?: string;
  redPhasePushedAt?: string;
  redPhasePushBranch?: string;
  redPhasePushRemoteUrl?: string;
  redPhasePushError?: string;
  // RED UPDATE — replay of the RED phase with a user-supplied
  // comment (the "переделай тесты с учётом…" pencil flow on the
  // ReviewReadyCard). The agent reads the existing tests in
  // the working tree itself — we don't pass the test files
  // into the prompt — and rewrites them to address the comment.
  // The user's comment is stored here so the process card can
  // show what the agent was asked to do. After the update
  // finishes, the same `commitAndPushRedTests` helper runs
  // from the exit handler and produces a new commit + push.
  redPhaseUpdatePid?: number | null;
  redPhaseUpdateStartedAt?: string;
  redPhaseUpdateExitCode?: number | null;
  redPhaseUpdateExitSignal?: string | null;
  redPhaseUpdateLogPath?: string;
  redPhaseUpdateComments?: string;
  // GREEN phase — `tdd-green-prompt-template.md`. Reads the
  // failing tests RED left on the feature branch, writes the
  // production code that makes them pass, commits each.
  // Spawned by the human-gated "Подтвердить" button on the
  // develop page (POST /api/changes/<tag>/implement/approve).
  // Renamed from the previous `implement*` fields when the
  // single-phase TDD pipeline was split into RED+GREEN.
  greenPhasePid?: number | null;
  greenPhaseStartedAt?: string;
  greenPhaseExitCode?: number | null;
  greenPhaseExitSignal?: string | null;
  greenPhaseLogPath?: string;
}

export interface AppState {
  tasks: Record<string, TaskEntry>;
}

/**
 * Single source of truth for the on-disk key of a task. We use a
 * composite `${mode}:${tag}` key so the same changeName can appear
 * in BOTH boards: the analyst-mode task (created via the API when
 * the proposal was authored) and a developer-mode task (created by
 * `mergeDeveloperScan` once the proposal is merged into
 * `config.defaultBranch`). Without composite keys, the second
 * `tasks.set(tag, ...)` would clobber the first.
 *
 * Tags can never contain `:` (OpenSpec convention: lowercase
 * kebab-case), so the key is unambiguous.
 */
export function taskKey(mode: TaskMode, tag: string): string {
  return `${mode}:${tag}`;
}

/**
 * Convert a board mode into the openspec-task mode. UEK-expert is
 * rejected because the UEK review board doesn't own openspec tasks;
 * callers should treat it as a "go back to the openspec modes"
 * signal.
 */
export function toTaskMode(mode: BoardModeId): TaskMode {
  if (mode === "uek-expert") {
    throw new Error(
      `Board mode "${mode}" does not own openspec tasks; switch to developer or analyst.`,
    );
  }
  return mode;
}

/**
 * Same as `toTaskMode` but returns a discriminated response instead
 * of throwing, suitable for the public API layer:
 *
 *   const taskMode = requireOpenspecMode(config.mode);
 *   if (!taskMode.ok) return taskMode.response;
 */
export function requireOpenspecMode(mode: BoardModeId):
  | { ok: true; taskMode: TaskMode }
  | { ok: false; response: Response } {
  if (mode === "uek-expert") {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error:
            'Board mode "uek-expert" does not own openspec tasks; switch to developer or analyst mode.',
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
  return { ok: true, taskMode: mode };
}

/**
 * Inverse of `taskKey`. Returns null for keys that don't match the
 * `${mode}:${tag}` shape — callers should fall back to scanning
 * both modes in that case.
 */
export function parseTaskKey(
  key: string,
): { mode: TaskMode; tag: string } | null {
  const idx = key.indexOf(":");
  if (idx <= 0 || idx === key.length - 1) return null;
  const mode = key.slice(0, idx);
  const tag = key.slice(idx + 1);
  if (mode !== "developer" && mode !== "analyst") return null;
  return { mode, tag };
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
  let raw: string;
  try {
    raw = await fs.readFile(STATE_FILE, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return EMPTY_STATE;
    throw e;
  }
  // fs.readFile returns "" for a zero-byte file without raising
  // — a half-flushed write (e.g. a SIGKILL mid-`fs.writeFile`,
  // a power loss, or an external `truncate`) leaves the file
  // present but empty. JSON.parse("") throws
  // "Unexpected end of JSON input", which previously escaped
  // the catch block and crashed every page render. Treat
  // empty the same as missing.
  if (raw.trim() === "") return EMPTY_STATE;
  let parsed: Partial<AppState>;
  try {
    parsed = JSON.parse(raw) as Partial<AppState>;
  } catch (e) {
    // Corrupt JSON (e.g. a half-written write that landed
    // something like `{"tasks":{"developer:foo":{` instead of
    // the full document) is also treated as "no state". The
    // next writeState call from updateTask / mergeScanWithState
    // will repopulate it. We log so a human can investigate
    // the corruption later if it keeps happening.
    console.warn(
      `[state] state.json is not valid JSON, treating as empty: ${(e as Error).message}`,
    );
    return EMPTY_STATE;
  }
  const rawTasks = parsed.tasks ?? {};
  const tasks: Record<string, TaskEntry> = {};
  // Backfill the composite `${mode}:${tag}` key for entries that
  // were written before this layout was introduced. Tags never
  // contain `:`, so a key without `:` is a legacy entry. We use
  // `task.mode` if present (it has been set on every new entry
  // since the field landed) and fall back to inferModeFromStage
  // for the rare orphan.
  for (const [key, task] of Object.entries(rawTasks)) {
    if (key.includes(":")) {
      tasks[key] = task;
    } else {
      const mode = task.mode ?? inferModeFromStage(task.stage);
      tasks[taskKey(mode, key)] = task;
    }
  }
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
  // Legacy key/mode mismatch fixup. Idempotent — runs on every
  // read but only patches records that disagree with their key
  // prefix. Doesn't persist; the next writeState call from any
  // caller (updateTask, watcher's metadata refresh, etc.) will
  // commit the corrected values. A read-only path between two
  // writes leaves the disk file stale but harmless — the very
  // next mutation flushes the patched view.
  migrateConsistentModeKeys(tasks);
  return { tasks };
}

export async function writeState(state: AppState): Promise<void> {
  // Atomic write — write to a tmp file in the same directory,
  // then rename. Protects state.json from being left empty
  // when a write is interrupted (SIGKILL, OOM, concurrent
  // writer, …) and from read-modify-write races between
  // updateTask and updateRepoEntry.
  await atomicWriteFile(
    STATE_FILE,
    JSON.stringify(state, null, 2) + "\n",
  );
}

function nextTaskId(_existing: Map<string, TaskEntry>): string {
  return randomUUID();
}

/**
 * Lightweight metadata-only refresh for a single LOCAL analyst-mode
 * task. Re-reads proposal.md / design.md / specs/ on disk and
 * returns the patch that should be written back to state.json.
 *
 * Scope: only `summary` fields derived from disk contents plus
 * `lastScannedAt`. Does NOT touch mode, stage, jiraUrl,
 * publishedBy, remoteBranch, sourceCommit, or any workflow-managed
 * field — safe to call periodically without disturbing in-flight
 * pipelines.
 *
 * Returns null when:
 *   - the task isn't a local analyst task (remote / wrong mode /
 *     git-source tasks are skipped; they have their own refresh
 *     path via `mergeRemoteFeatureScan`),
 *   - the underlying filesystem source can't be read right now
 *     (caller retries on the next tick),
 *   - no patch differs from the current persisted snapshot
 *     (also returned as null so callers can skip the write).
 */
export async function refreshAnalystTaskSummary(
  task: TaskEntry,
  openspecDir: string,
): Promise<Pick<TaskEntry, "lastScannedAt" | "summary"> | null> {
  if (task.mode !== "analyst") return null;
  // Remote-analyst tasks ride along with mergeRemoteFeatureScan —
  // touching them here would race with that pass.
  if (task.remote) return null;

  const { resolveArtifactSource, scanOneRoot } = await import("./openspec");
  const source = await resolveArtifactSource(task, openspecDir);
  // The git branch only fires during a tiny window between a
  // remote-branch first being seen and its mirror worktree being
  // materialized. Skip rather than guess — the very next scan will
  // turn this into a fs-root via materializeMirror().
  if (source.kind !== "fs") return null;

  let summaries: ChangeSummary[];
  try {
    summaries = await scanOneRoot(source.root);
  } catch (e) {
    console.warn(
      `[state] refresh summary failed for ${task.summary.changeName}: ${(e as Error).message}`,
    );
    return null;
  }
  const fresh = summaries.find(
    (s) => s.changeName === task.summary.changeName,
  );
  // The change folder disappeared from disk since last scan. We
  // don't delete the task here — deletion is owned by archive /
  // cleanup flows elsewhere — but we also don't pretend it's still
  // there. Returning null keeps the previous summary intact until
  // the caller decides what to do.
  if (!fresh) return null;

  // No-op detection. Avoid a write round-trip on a quiet board —
  // writes hit atomicWriteFile + JSON.stringify + rename, which
  // adds up over many idle ticks.
  const s = task.summary;
  if (
    s.title === fresh.title &&
    s.path === fresh.path &&
    s.hasProposal === fresh.hasProposal &&
    s.hasDesign === fresh.hasDesign &&
    s.hasSpecs === fresh.hasSpecs &&
    s.fileCount === fresh.fileCount &&
    s.totalSize === fresh.totalSize &&
    s.updatedAt === fresh.updatedAt &&
    s.specCounts.added === fresh.specCounts.added &&
    s.specCounts.modified === fresh.specCounts.modified &&
    s.specCounts.removed === fresh.specCounts.removed &&
    s.specCounts.scenarios === fresh.specCounts.scenarios &&
    arraysEqual(s.capabilityTags, fresh.capabilityTags) &&
    arraysEqual(s.newCapabilities, fresh.newCapabilities) &&
    arraysEqual(s.modifiedCapabilities, fresh.modifiedCapabilities)
  ) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    lastScannedAt: now,
    summary: {
      ...fresh,
      id: task.id,
      stage: task.stage,
    },
  };
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * One-shot consistency fixup for legacy entries whose composite
 * key prefix disagrees with their persisted `mode`.
 *
 * The pre-refactor `mergeScanWithState` wrote new disk-discovery
 * entries under `analyst:<tag>` while setting `mode` to
 * `"developer"` (see `inferModeFromStage("backlog")`). Those
 * records are filtered out by the board because the page-level
 * filter compares against `task.mode`, not the key prefix.
 *
 * The fix trusts the key prefix: state keys were always built via
 * `taskKey(mode, tag)` at creation time, so a surviving key like
 * `analyst:fpsu-lic-req-metric` is strong evidence the original
 * intent was to place this record on the analyst board. Aligning
 * `task.mode` with the prefix is therefore safe — it brings the
 * entry back onto the correct column without losing any data.
 *
 * Idempotent. Called once per process boot from `readState()`; the
 * actual persistence happens the next time anything else writes
 * state.json (`updateTask` / `mergeScanWithState` callers /
 * `triggerContinueIfNeeded`), so a crash before any such write
 * leaves the on-disk file unchanged for the next attempt.
 */
export function migrateConsistentModeKeys(
  tasks: Record<string, TaskEntry>,
): { patched: number } {
  let patched = 0;
  for (const [key, task] of Object.entries(tasks)) {
    const parsed = parseTaskKey(key);
    if (!parsed) continue;
    if (parsed.mode !== task.mode) {
      task.mode = parsed.mode;
      patched++;
    }
  }
  return { patched };
}

/**
 * Developer-mode scan: walk `openspecDir`'s `config.defaultBranch`
 * via `scanChangeProposalsOnBranch`, then merge the result into
 * `state.tasks`:
 *
 *   - Live change-proposal, no existing task → new developer-mode
 *     task in `backlog`.
 *   - Live change-proposal, existing developer-mode task → refresh
 *     its content + sha + archived flag; keep stage / mode.
 *   - Live change-proposal, existing analyst-mode task in `done`
 *     (or any stage) → the analyst run finished and the proposal
 *     is now upstream. Create a NEW developer-mode task alongside
 *     the analyst one (composite key, so they don't collide); the
 *     analyst task is preserved as-is for history.
 *   - Live change-proposal, existing analyst-mode task NOT in
 *     `done` (e.g. still in design) → skip; the analyst is still
 *     working on it, don't shadow.
 *   - Archived change-proposal that's no longer live →
 *     `archived: true` on the existing developer-mode task. The
 *     dev's task stays in whatever stage it was at; the red
 *     "архив" badge will appear on the card so they know to close
 *     it.
 *   - Archived change-proposal whose existing developer-mode task
 *     is in `backlog` → task removed outright (the dev workflow
 *     never picked it up).
 *   - A task that has neither live nor archived proposal upstream
 *     is left alone — it might be an old local task the dev is
 *     still working on, or one whose remote we couldn't see.
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
  for (const p of proposals) {
    if (p.archived) archivedTags.add(p.tag);
    else liveTags.add(p.tag);
  }

  let created = 0;
  let archived = 0;
  let removed = 0;

  for (const p of proposals) {
    const devKey = taskKey("developer", p.tag);
    const analystKey = taskKey("analyst", p.tag);
    const devTask = tasks.get(devKey);
    const analystTask = tasks.get(analystKey);

    if (p.archived) {
      // Live + archived: change lives in both, treat as live.
      // (The dev can still pick it up — `git show origin/<branch>`
      // would resolve to the live copy.)
      if (liveTags.has(p.tag)) continue;
      if (!devTask) continue; // not in our dev board yet
      tasks.set(devKey, {
        ...devTask,
        lastScannedAt: now,
        archived: true,
      });
      archived++;
      continue;
    }

    // Live proposal.
    if (devTask) {
      // Existing developer-mode task — refresh content + sha +
      // artifact flags + archived flag; preserve stage, mode,
      // all dev-managed fields. Artifact flags are derived from
      // the upstream tree on every scan, so a proposal that
      // grows new files (e.g. design.md lands after the initial
      // merge) flips hasDesign/hasSpecs without a manual edit.
      //
      // The dev-mode task name is the tag (canonical identifier
      // — the analyst author may have written a longer prose
      // title in the proposal, but the dev workflow keys on the
      // kebab-case tag everywhere: worktree paths, branch names,
      // git refs, the URL segment). The proposal's `title`
      // (parsed `p.title` from the first `# Heading`) is no
      // longer surfaced on dev-board cards.
      tasks.set(devKey, {
        ...devTask,
        lastScannedAt: now,
        archived: false,
        codeBranch: branch,
        codeBaseSha: p.sha,
        summary: {
          ...devTask.summary,
          title: p.tag,
          changeName: p.tag,
          hasDesign: p.hasDesign,
          hasSpecs: p.hasSpecs,
        },
        description: p.description,
        jiraUrl: p.jiraUrl ?? devTask.jiraUrl,
      });
      continue;
    }

    if (analystTask && analystTask.mode === "analyst") {
      // The same changeName has an analyst-mode task. The analyst
      // either finished (stage=done) or is still mid-flight (any
      // other stage). Either way, the proposal is upstream on
      // `defaultBranch` — the dev board should see it.
      //
      // - If the analyst run is done → today marks the
      //   "graduation" of the proposal: drop a new developer-mode
      //   task in backlog. The analyst task (history) stays.
      // - If the analyst is mid-flight → still drop a developer
      //   task. The dev workflow can use the proposal in
      //   parallel (different worktrees, different code repos);
      //   the analyst task is unaffected.
      //
      // We always create a new dev task when only an analyst
      // task exists for this tag — making the dev scan the
      // single source of truth for "this proposal is ready for
      // implementation".
      //
      // The dev task pulls description and jiraUrl **only** from
      // the parsed proposal (p.description / p.jiraUrl). It must
      // never inherit them from the analyst companion — that
      // would be a cross-mode data leak, and would also let an
      // analyst-mode task with no `Jira:` line in proposal.md
      // silently propagate the analyst's jiraUrl into the dev
      // record. If p.jiraUrl is null, the dev task has no
      // jiraUrl either; the page badge stays empty and the
      // /start endpoint will 409 with "add Jira to proposal.md".
      const id = randomUUID();
      tasks.set(devKey, {
        id,
        mode: "developer",
        stage: "backlog",
        lastScannedAt: now,
        summary: {
          id,
          changeName: p.tag,
          path: "",
          title: p.tag,
          stage: "backlog",
          hasProposal: true,
          hasDesign: p.hasDesign,
          hasSpecs: p.hasSpecs,
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
      continue;
    }

    // No prior task at all — fresh developer-mode backlog entry.
    const id = randomUUID();
    tasks.set(devKey, {
      id,
      mode: "developer",
      stage: "backlog",
      lastScannedAt: now,
      summary: {
        id,
        changeName: p.tag,
        path: "",
        title: p.tag,
        stage: "backlog",
        hasProposal: true,
        hasDesign: p.hasDesign,
        hasSpecs: p.hasSpecs,
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

  // Cleanup: tasks that no longer have a live proposal upstream
  // and have moved to archive. Backlog tasks are removed;
  // anything past backlog is flagged archived. We only act on
  // developer-mode tasks — analyst-mode tasks are untouched by
  // this scan.
  for (const [key, task] of Array.from(tasks.entries())) {
    if (task.mode !== "developer") continue;
    const parsed = parseTaskKey(key);
    if (!parsed) continue;
    const tag = parsed.tag;
    if (liveTags.has(tag)) continue; // still live
    if (!archivedTags.has(tag)) continue; // not archived upstream either
    if (task.stage === "backlog") {
      tasks.delete(key);
      removed++;
    } else if (!task.archived) {
      tasks.set(key, { ...task, lastScannedAt: now, archived: true });
      archived++;
    }
  }

  await writeState({ tasks: Object.fromEntries(tasks) });
  return { scanned: proposals.length, created, archived, removed };
}

/**
 * Patch a single task. The caller MUST pass the mode — the
 * on-disk key is the composite `${mode}:${tag}`, so without a
 * mode we can't locate the right entry (the same changeName can
 * exist in both boards).
 *
 * The mode is intentionally a required parameter (vs. inferred
 * from the existing task) so the call site is explicit about
 * which board a write targets. API routes already know their
 * mode (the action itself is mode-specific — confirm/update-*
 * are analyst-mode, start/update-branch are developer-mode).
 */
export async function updateTask(
  mode: TaskMode,
  changeName: string,
  patch: Partial<TaskEntry>,
): Promise<TaskEntry | null> {
  const state = await readState();
  const key = taskKey(mode, changeName);
  const existing = state.tasks[key];
  if (!existing) return null;
  const updated: TaskEntry = { ...existing, ...patch };
  // Keep `summary.stage` in lockstep with `task.stage` — the board
  // reads `BoardItem.stage` from `summary.stage`, not `task.stage`,
  // so a stage-only patch would otherwise leave the task visually
  // stuck in its old column after a successful confirm.
  if (patch.stage !== undefined) {
    updated.summary = { ...updated.summary, stage: patch.stage };
  }
  state.tasks[key] = updated;
  await writeState(state);
  return updated;
}

/**
 * Look up a task by tag, preferring the mode that matches the
 * current board. Used by URL-routed pages where the [tag]
 * segment doesn't carry the mode — the board context
 * (config.mode) decides which entry to show.
 *
 * Returns null when neither `developer:<tag>` nor `analyst:<tag>`
 * is present.
 */
/**
 * Lookup a task by tag, preferring `preferredMode` and falling back
 * to the other openspec mode if needed.
 *
 * Accepts any `BoardModeId` (including `uek-expert`); the UEK-expert
 * mode doesn't own openspec tasks, so the call resolves to a lookup
 * across both openspec modes only.
 */
export async function findTaskByTag(
  changeName: string,
  preferredMode: BoardModeId,
): Promise<{ key: string; task: TaskEntry } | null> {
  const state = await readState();
  // UEK-expert mode doesn't own openspec tasks; fall back to
  // searching both openspec modes without bias.
  const modesToTry: TaskMode[] =
    preferredMode === "uek-expert"
      ? ["developer", "analyst"]
      : [
          preferredMode as TaskMode,
          (preferredMode === "developer" ? "analyst" : "developer") as TaskMode,
        ];
  for (const mode of modesToTry) {
    const key = taskKey(mode, changeName);
    if (state.tasks[key]) {
      return { key, task: state.tasks[key] };
    }
  }
  return null;
}

/**
 * Mode-strict lookup: returns the task in the named mode for the
 * given tag, or null. Does NOT fall back to the other mode.
 *
 * Use this from developer-mode endpoints (/start, /confirm for
 * the plan stage) so an analyst companion task can never be
 * picked up as the target of a developer-mode action. Composite
 * keys already keep the two modes separate in state.json, but a
 * non-strict lookup could still return the wrong entry on
 * miss-hits and silently leak analyst-side fields into
 * developer-mode code paths.
 */
export async function findTaskByTagStrict(
  mode: TaskMode,
  changeName: string,
): Promise<TaskEntry | null> {
  const state = await readState();
  return state.tasks[taskKey(mode, changeName)] ?? null;
}

/**
 * Delete a task by composite key. Convenient for cleanup
 * endpoints (e.g. delete/route.ts) that own the mode context.
 */
export async function deleteTask(
  mode: TaskMode,
  changeName: string,
): Promise<boolean> {
  const state = await readState();
  const key = taskKey(mode, changeName);
  if (!state.tasks[key]) return false;
  delete state.tasks[key];
  await writeState(state);
  return true;
}

/**
 * Stage-from-artifacts helper. Given the artifact flags the
 * scanner extracted from a remote branch's tree, decide what
 * stage the change-proposal has reached. We only return stages
 * that can be CONFIRMED purely from on-disk evidence — adr
 * means adr.md exists; design means design.md exists; if
 * neither specs nor design nor adr are present, we stay on
 * `proposal`. (We never auto-advance to `done` from artifacts
 * alone — the analyst must explicitly confirm `adr` for that.)
 *
 * This mirrors what the local analyst flow does on each
 * confirm-button click: the watcher checks
 * `openspec/changes/<tag>/<artifact>` after every commit. We
 * apply the same rule to remote branches.
 */
function inferAnalystStageFromArtifacts(
  hasSpecs: boolean,
  hasDesign: boolean,
  hasAdr: boolean,
): "proposal" | "delta-spec" | "design" | "adr" {
  if (hasAdr) return "adr";
  if (hasDesign) return "design";
  if (hasSpecs) return "delta-spec";
  return "proposal";
}

/**
 * Fold a remote feature-branches scan into state.json.
 *
 * Semantics per `RemoteBranchProposal`:
 *
 *   - No matching `analyst:<tag>` entry → create a new
 *     read-only task with `remote: true`, `publishedBy`,
 *     `remoteBranch`, `sourceCommit`. Stage is inferred from
 *     artifact presence (proposal / delta-spec / design).
 *   - Existing entry whose `remoteBranch === proposal.remoteRef`
 *     → "tracked remote". Refresh `lastScannedAt`, `sourceCommit`,
 *     `publishedBy` (if changed), `summary.{title,description}`.
 *   - Existing entry with a DIFFERENT `remoteBranch` → that's
 *     a local task with the same tag (POST /api/changes made
 *     it). Skip the merge step. The local workflow owns this
 *     record; we never overwrite it from a remote scan.
 *
 * The third case is important: if user B starts working on a
 * proposal locally (creates worktree, commits) WITHOUT
 * publishing yet, and user A independently pushes
 * `feature/<X>` with a different `<tag>`, the tags differ and
 * there's no collision. But if both happen to use the SAME
 * tag, user A's push should NOT overwrite user B's local
 * progress. We detect this by `remoteBranch !== proposal.remoteRef`
 * — local tasks have `remoteBranch` unset or pointing at a
 * different ref (after they push their own branch, the watcher's
 * existing tracking logic takes over).
 *
 * Returns counts for diagnostics + UI toasts. The watcher
 * doesn't surface them but the manual ↻ endpoint does.
 */
export async function mergeRemoteFeatureScan(
  openspecDir: string,
): Promise<{ discovered: number; updated: number; unchanged: number; removed: number }> {
  // Serialize concurrent invocations — the watcher's tick and a
  // manual ↻ click must not run the scan in parallel. Without
  // this lock the two callers race on writeState and the slower
  // one's writes silently clobber the faster one's updates
  // (last-write-wins on the same JSON file). The lock is keyed
  // by openspecDir so two different stores (e.g. two sdd-board
  // instances pointed at different roots) don't queue behind
  // each other.
  return runExclusive(`remote-scan:${openspecDir}`, () =>
    mergeRemoteFeatureScanImpl(openspecDir),
  );
}

async function mergeRemoteFeatureScanImpl(
  openspecDir: string,
): Promise<{ discovered: number; updated: number; unchanged: number; removed: number }> {
  const { scanRemoteFeatureBranches } = await import(
    "./feature-branches-scanner"
  );
  const proposals = await scanRemoteFeatureBranches(openspecDir);
  const state = await readState();
  const tasks = new Map<string, TaskEntry>(Object.entries(state.tasks));
  const now = new Date().toISOString();

  let discovered = 0;
  let updated = 0;
  let unchanged = 0;
  let removed = 0;

  // Materialize (or refresh) a remote branch's read-only mirror
  // worktree so its files are available on disk like a local task's.
  // Non-fatal: if the worktree can't be created/reset we return
  // undefined and the caller leaves `openspecWorktreePath` unset —
  // the git-reading fallback keeps the board correct until the next
  // scan retries.
  async function materializeMirror(remoteRef: string): Promise<string | undefined> {
    try {
      return await ensureRemoteReadonlyWorktree(openspecDir, remoteRef);
    } catch (e) {
      console.warn(`[remote-worktree] materialize ${remoteRef} failed:`, e);
      return undefined;
    }
  }

  // Track which remote refs survive this scan — every existing
  // remote-task whose `remoteBranch` is not in this set has lost
  // its upstream branch (the author pushed `--delete`, or pruned
  // the remote). We remove the orphan at the end of the pass,
  // deleting both the state entry and the now-orphaned
  // .remote-worktrees/<feature>/ directory.
  const liveRemoteRefs = new Set<string>();

  for (const p of proposals) {
    if (!p.hasProposal || !p.tag) continue;
    const tag = p.tag;
    const key = taskKey("analyst", tag);
    liveRemoteRefs.add(p.remoteRef);
    const existing = tasks.get(key);

    if (!existing) {
      // Fresh discovery: brand-new read-only task. Materialize the
      // read-only mirror FIRST so the stage can be read from the
      // author's .openspec.yaml (ground truth); fall back to
      // artifact-presence inference only when there is no mirror or
      // no metadata. Failure is non-fatal — the task stays readable
      // via the git fallback and the next scan retries.
      const id = randomUUID();
      const mirrorPath = await materializeMirror(p.remoteRef);
      const stage =
        (mirrorPath
          ? await readStageFromOpenspecYaml(mirrorPath, tag)
          : null) ??
        inferAnalystStageFromArtifacts(p.hasSpecs, p.hasDesign, p.hasAdr);
      const summary = {
        id,
        changeName: tag,
        path: "",
        title: p.proposalTitle ?? tag,
        stage,
        hasProposal: true,
        hasDesign: p.hasDesign,
        hasSpecs: p.hasSpecs,
        capabilityTags: [],
        newCapabilities: [],
        modifiedCapabilities: [],
        specCounts: {
          added: 0,
          modified: 0,
          removed: 0,
          scenarios: 0,
        },
        updatedAt: now,
        fileCount: 0,
        totalSize: 0,
      };
      // (mirrorPath already materialized above, before stage
      // resolution — the files are on disk for the user to open.)
      tasks.set(key, {
        id,
        mode: "analyst",
        stage,
        lastScannedAt: now,
        summary,
        description: p.proposalDescription ?? "",
        jiraUrl: p.jiraUrl ?? undefined,
        remote: true,
        remoteBranch: p.remoteRef,
        sourceCommit: p.sha,
        publishedBy: p.publishedBy,
        // The read-only worktree path (remote stays true — this is a
        // mirror, not a local task). Unset when materialization
        // failed, in which case the git-reading fallback applies.
        openspecWorktreePath: mirrorPath,
      });
      discovered++;
      continue;
    }

    // Existing entry. Only treat it as "our copy of this remote
    // branch" if the remoteBranch matches. Otherwise it's a
    // local task with the same tag — leave it alone.
    if (existing.remote !== true || existing.remoteBranch !== p.remoteRef) {
      // Not our record. Skip.
      continue;
    }

    // Same branch, same tag. Compare SHA + author to decide
    // whether the summary needs refreshing.
    const sameSha = existing.sourceCommit === p.sha;
    const sameAuthor =
      existing.publishedBy?.email === p.publishedBy.email &&
      existing.publishedBy?.name === p.publishedBy.name;
    if (sameSha && sameAuthor) {
      // No content change. Keep the existing mirror if one is
      // already present AND still on disk; if the mirror path
      // was lost (user rm-rf'd the .remote-worktrees/<feature>
      // dir, or an earlier materialization failed), recreate
      // it now so files become available again.
      let mirrorPath = existing.openspecWorktreePath;
      if (mirrorPath && !(await remoteWorktreeExists(openspecDir, p.remoteRef))) {
        // Persisted path is stale — drop it and re-materialize.
        mirrorPath = undefined;
      }
      if (!mirrorPath) {
        mirrorPath = await materializeMirror(p.remoteRef);
      }
      tasks.set(
        key,
        mirrorPath === existing.openspecWorktreePath
          ? { ...existing, lastScannedAt: now }
          : { ...existing, lastScannedAt: now, openspecWorktreePath: mirrorPath },
      );
      unchanged++;
      continue;
    }

    // SHA or author changed (force-push upstream, or someone
    // amended). Refresh the persisted fields. Reset the mirror to
    // the new tip FIRST, then read the stage from the author's
    // .openspec.yaml (ground truth) with the file-presence inference
    // as fallback.
    const mirrorPath = await materializeMirror(p.remoteRef);
    const newStage =
      (mirrorPath
        ? await readStageFromOpenspecYaml(mirrorPath, tag)
        : null) ??
      inferAnalystStageFromArtifacts(p.hasSpecs, p.hasDesign, p.hasAdr);
    const refreshedSummary = {
      ...existing.summary,
      title: p.proposalTitle ?? existing.summary.title,
      stage: newStage,
      hasDesign: p.hasDesign,
      hasSpecs: p.hasSpecs,
      updatedAt: now,
    };
    tasks.set(key, {
      ...existing,
      lastScannedAt: now,
      stage: newStage,
      sourceCommit: p.sha,
      publishedBy: p.publishedBy,
      summary: refreshedSummary,
      description: p.proposalDescription ?? existing.description,
      jiraUrl: p.jiraUrl ?? existing.jiraUrl,
      openspecWorktreePath: mirrorPath,
    });
    updated++;
  }

  // Orphan cleanup: a remote task whose `remoteBranch` was
  // gone from origin's `feature/*` namespace at scan time
  // (after `git fetch --prune`) is no longer authored by
  // anyone. Without this pass the task would sit on the board
  // forever and the corresponding `.remote-worktrees/<feature>/`
  // would leak disk space. We delete the state entry and best-
  // effort tear down the mirror; failure of the latter is
  // non-fatal because the worktree is no longer referenced
  // anywhere in state.
  //
  // We only act on tasks explicitly marked `remote: true`
  // with a `remoteBranch` ref — local tasks are NEVER cleaned
  // up here, even when their tag collides with a now-gone
  // remote ref (per the cross-mode isolation rule documented
  // above).
  for (const [key, task] of Array.from(tasks.entries())) {
    if (task.remote !== true) continue;
    if (!task.remoteBranch) continue;
    if (liveRemoteRefs.has(task.remoteBranch)) continue;
    tasks.delete(key);
    removed++;
    void removeRemoteReadonlyWorktree(openspecDir, task.remoteBranch);
  }

  await writeState({ tasks: Object.fromEntries(tasks) });
  return { discovered, updated, unchanged, removed };
}