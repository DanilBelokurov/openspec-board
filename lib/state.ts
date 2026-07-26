import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { ChangeSummary, Stage } from "./openspec";
import { MODES, type BoardModeId } from "./modes";
import { atomicWriteFile } from "./atomic-write";

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

export async function mergeScanWithState(
  summaries: ChangeSummary[],
): Promise<AppState> {
  const state = await readState();
  const tasks = new Map<string, TaskEntry>(Object.entries(state.tasks));
  const now = new Date().toISOString();

  for (const summary of summaries) {
    // Analyst-mode scan: every task here lives in the analyst
    // bucket. Composite key, not the raw changeName, so it doesn't
    // collide with a developer-mode task for the same change.
    const key = taskKey("analyst", summary.changeName);
    const prev = tasks.get(key);
    if (prev) {
      tasks.set(key, {
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
      tasks.set(key, {
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
export async function findTaskByTag(
  changeName: string,
  preferredMode: TaskMode,
): Promise<{ key: string; task: TaskEntry } | null> {
  const state = await readState();
  const preferredKey = taskKey(preferredMode, changeName);
  if (state.tasks[preferredKey]) {
    return { key: preferredKey, task: state.tasks[preferredKey] };
  }
  const otherMode: TaskMode = preferredMode === "developer" ? "analyst" : "developer";
  const otherKey = taskKey(otherMode, changeName);
  if (state.tasks[otherKey]) {
    return { key: otherKey, task: state.tasks[otherKey] };
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