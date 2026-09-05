import { execFile } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import {
  readState,
  writeState,
  findTaskByTag,
  taskKey,
  type TaskEntry,
} from "@/lib/state";
import { readConfig } from "@/lib/config";
import { isGitRepo } from "@/lib/git";
import { cleanupTask } from "@/lib/git-cleanup";
import { terminateProcess } from "@/lib/process";

function execGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { maxBuffer: 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `git ${args.join(" ")} failed: ${err.message}\n${stderr}`,
            ),
          );
          return;
        }
        resolve({ stdout: String(stdout).trim(), stderr: String(stderr) });
      },
    );
  });
}

/**
 * Active PID fields on a task — used by destructive teardown so
 * an in-flight child doesn't race the worktree removal. Mirrors
 * the redPhase/greenPhase fields on `TaskEntry`; deliberately
 * narrow so we don't accidentally try to kill unrelated
 * long-lived processes (e.g. analyst-mode gigacode runs whose
 * worktree lives elsewhere).
 */
const TDD_PHASE_PIDS: (keyof TaskEntry)[] = [
  "redPhasePid",
  "redPhaseUpdatePid",
  "greenPhasePid",
];

async function terminateLiveTddPhases(
  task: TaskEntry,
): Promise<{ pid: keyof TaskEntry; outcome: string }[]> {
  const results: { pid: keyof TaskEntry; outcome: string }[] = [];
  for (const field of TDD_PHASE_PIDS) {
    const pid = task[field] as number | null | undefined;
    if (pid == null) continue;
    const outcome = await terminateProcess(pid, { timeoutMs: 3000 });
    results.push({ pid: field, outcome });
  }
  return results;
}

/**
 * Resolve the worktree path and branch name for a task, with
 * safe fallbacks. The worktree may already be gone if a previous
 * partial delete ran — in that case we return nulls and the
 * caller skips the cleanup but still drops the state entry.
 */
function resolveWorktreeInfo(
  task: TaskEntry,
): { worktreePath: string | null } {
  return {
    worktreePath: task.openspecWorktreePath ?? null,
  };
}

async function readBranchName(worktreePath: string): Promise<string | null> {
  try {
    const { stdout } = await execGit(worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    return stdout || null;
  } catch {
    return null;
  }
}

async function cleanupSingleTask(
  openspecDir: string,
  task: TaskEntry,
  tag: string,
  options: {
    deleteRemote: boolean;
    skipBranchDelete: boolean;
  },
  actions: { step: string; ok: boolean; error?: string }[],
): Promise<void> {
  const { worktreePath } = resolveWorktreeInfo(task);

  // Kill any in-flight RED/GREEN phase first so the worktree
  // removal below doesn't race a child holding files open.
  for (const r of await terminateLiveTddPhases(task)) {
    actions.push({
      step: `terminate ${String(r.pid)} (${tag})`,
      ok: r.outcome !== "skipped",
      error: r.outcome === "skipped" ? "EPERM or invalid pid" : undefined,
    });
  }

  if (!worktreePath) {
    actions.push({
      step: `cleanup ${tag}`,
      ok: true,
      error: "(no openspecWorktreePath — skipped git teardown)",
    });
    return;
  }

  // Read the branch from the worktree itself — same source as
  // /confirm uses. If the worktree is already gone we fall back
  // to "branch unknown" and cleanupTask still prunes + drops the
  // local branch (no-op if it isn't there).
  const branchName = await readBranchName(worktreePath);
  if (!branchName) {
    actions.push({
      step: `rev-parse HEAD (${tag})`,
      ok: false,
      error:
        "Не удалось прочитать имя ветки — worktree уже отсутствует или не является git-репозиторием",
    });
    // Still run cleanupTask with a placeholder branch so worktree
    // prune / branch -D run as best-effort. The branch step will
    // fail silently if the branch is already gone.
    const { actions: cleanupActions } = await cleanupTask(
      openspecDir,
      worktreePath,
      "unknown-branch-cleanup-attempt",
      {
        deleteRemote: false,
        skipBranchDelete: options.skipBranchDelete,
        codeRepoPath: task.codeRepoPath ?? undefined,
        codeWorktreePath: task.codeWorktreePath ?? undefined,
      },
    );
    for (const a of cleanupActions) {
      actions.push({ ...a, step: `[${tag}] ${a.step}` });
    }
    return;
  }

  const { actions: cleanupActions } = await cleanupTask(
    openspecDir,
    worktreePath,
    branchName,
    {
      deleteRemote: options.deleteRemote,
      skipBranchDelete: options.skipBranchDelete,
      codeRepoPath: task.codeRepoPath ?? undefined,
      codeWorktreePath: task.codeWorktreePath ?? undefined,
    },
  );
  // Prefix each step with the task tag so the response makes
  // it obvious which teardown each line belongs to when the
  // cascade touches several siblings.
  for (const a of cleanupActions) {
    actions.push({ ...a, step: `[${tag}] ${a.step}` });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Сначала укажите директорию OpenSpec store в настройках" },
      { status: 400 },
    );
  }
  const sp = req.nextUrl.searchParams;
  // ?remote=1 — additionally remove the branch from the `origin`
  // remote via `git push origin --delete <branch>`. Off by
  // default; the local worktree + local branch are always torn
  // down. Accepting any truthy value of "remote" (`1`, `true`,
  // `yes`) keeps it forgiving for hand-typed URLs.
  const deleteRemote = /(?:^|&)(?:1|true|yes)/i.test(sp.get("remote") ?? "");
  // ?cascade=1 — when the deleted task is a child with a parent
  // plan, also remove the parent AND every sibling the parent
  // tracked in `childTags`. The intent is to leave zero state
  // entries behind: child + parent share the same openspec
  // worktree, so dropping one without the other leaves the
  // board referencing a gone worktree. The `remote` flag, if
  // set, propagates to every cascaded teardown so the user
  // gets a single round-trip.
  const cascade = /(?:^|&)(?:1|true|yes)/i.test(sp.get("cascade") ?? "");

  const state = await readState();
  // Delete is mode-agnostic — it tears down the worktree for
  // whichever board the user is on. Prefer the current board's
  // task; fall back to the other mode if needed.
  const found = await findTaskByTag(params.tag, config.mode);
  const task = found?.task;
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена` },
      { status: 404 },
    );
  }
  if (!task.openspecWorktreePath) {
    return NextResponse.json(
      { error: "У задачи не записан openspecWorktreePath — нечего удалять" },
      { status: 400 },
    );
  }
  // Remote tasks are read-only mirrors of another user's branch —
  // "delete" would teardown a worktree the user doesn't own.
  // The board entry is left in place (it reflects upstream state).
  if (task.remote === true) {
    return NextResponse.json(
      { error: "Задача опубликована другим пользователем — удаление недоступно" },
      { status: 403 },
    );
  }
  if (!(await isGitRepo(config.openspecDir))) {
    return NextResponse.json(
      {
        error: `Директория OpenSpec store не является git-репозиторием: ${config.openspecDir}`,
      },
      { status: 400 },
    );
  }

  const actions: { step: string; ok: boolean; error?: string }[] = [];
  const removedTags: string[] = [];

  // Build the set of tasks we will tear down. For a non-cascaded
  // delete, it's just the primary task. For a cascaded delete
  // (child of a multi-service plan), it's the parent + every
  // sibling the parent tracks in `childTags`, plus the primary
  // task. Order matters: we tear down siblings first (so the
  // parent is the last to go — its `childTags` becomes
  // vacuously empty) and the parent last.
  const teardownTasks: { tag: string; entry: TaskEntry }[] = [];
  let parentEntry: TaskEntry | null = null;

  if (cascade && task.parentTag) {
    const parentKey = taskKey("developer", task.parentTag);
    const candidate = state.tasks[parentKey];
    if (!candidate) {
      return NextResponse.json(
        {
          error: `Каскад запрошен, но родительская задача «${task.parentTag}» не найдена`,
        },
        { status: 404 },
      );
    }
    if (candidate.mode !== "developer") {
      return NextResponse.json(
        {
          error: `Каскад доступен только для дерева задач режима «developer»`,
        },
        { status: 409 },
      );
    }
    parentEntry = candidate;
    const siblingTags = (candidate.childTags ?? []).filter(
      (t) => t !== params.tag,
    );
    for (const siblingTag of siblingTags) {
      const siblingKey = taskKey("developer", siblingTag);
      const sibling = state.tasks[siblingKey];
      if (sibling) teardownTasks.push({ tag: siblingTag, entry: sibling });
    }
  }

  // Always teardown the primary task; if we're cascading, we
  // also do it before the parent so the parent (whose
  // `childTags` lists this task) is the last to leave.
  if (!teardownTasks.some((t) => t.tag === params.tag)) {
    teardownTasks.unshift({ tag: params.tag, entry: task });
  }

  // Run the per-task cleanups sequentially. Each is independent
  // (different worktree / branch), but order keeps the actions[]
  // log readable and prevents a slow prune from interleaving
  // with another task's ls-remote. The branch-delete step is
  // shared across the whole cascade (parent + siblings + primary
  // all sit on `feature/<JIRA-ID>`), so only one teardown in
  // the whole batch owns it — every other call sets
  // `skipBranchDelete: true`. We choose the FIRST teardown in
  // the list as the owner: for a non-cascaded delete that's
  // the primary task, for a cascaded delete it's the first
  // sibling (the primary task itself, since it was unshifted
  // above). The parent (when present) runs last and reports
  // skipBranchDelete too.
  const ownerIdx = 0;
  for (let i = 0; i < teardownTasks.length; i++) {
    const t = teardownTasks[i];
    await cleanupSingleTask(
      config.openspecDir,
      t.entry,
      t.tag,
      {
        deleteRemote,
        skipBranchDelete: i !== ownerIdx,
      },
      actions,
    );
    removedTags.push(t.tag);
  }

  // Finally, the parent (only for cascaded deletes). The parent
  // also gets `skipBranchDelete: true` because the primary
  // task already pushed --delete to origin and dropped the
  // local branch ref above.
  if (parentEntry && task.parentTag) {
    await cleanupSingleTask(
      config.openspecDir,
      parentEntry,
      task.parentTag,
      { deleteRemote, skipBranchDelete: true },
      actions,
    );
    removedTags.push(task.parentTag);
  }

  // Drop every removed entry from state in a single write.
  // Sibling entries in the other mode (analyst/developer with
  // the same tag) are intentionally preserved — they are
  // independent records.
  const nextTasks = { ...state.tasks };
  for (const tag of removedTags) {
    delete nextTasks[taskKey("developer", tag)];
  }
  await writeState({ tasks: nextTasks });

  return NextResponse.json({
    ok: true,
    tag: params.tag,
    cascade,
    removedTags,
    actions,
  });
}