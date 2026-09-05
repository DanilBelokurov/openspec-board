import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { findTaskByTagStrict, updateTask } from "@/lib/state";
import { isGitRepo } from "@/lib/git";
import {
  takeOverRemoteWorktree,
  TakeOverError,
} from "@/lib/remote-worktree";

/**
 * POST /api/changes/<tag>/take-over — «Взять в работу».
 *
 * Promotes a remote task (a read-only mirror of another user's
 * published branch) into a locally editable analyst task:
 *
 *   1. creates the local branch `feature/<jiraId>` from the remote
 *      tip (an existing local branch is left untouched),
 *   2. materializes an editable worktree at the standard
 *      `<openspecBasename>.worktrees/<jiraId>/` path,
 *   3. removes the detached read-only mirror,
 *   4. clears the remote-tracking fields on the TaskEntry
 *      (`remote` / `remoteBranch` / `sourceCommit` / `publishedBy`)
 *      so the watcher's remote scan stops managing it and the
 *      read-only guards on confirm/pencil/push stop firing.
 *
 * Per the agreed product decision, taking over does NOT gate on
 * /confirm — the artifacts are already committed upstream by the
 * author; the user continues from the current stage.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Сначала укажите директорию OpenSpec store в настройках" },
      { status: 400 },
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

  const task = await findTaskByTagStrict("analyst", params.tag);
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена в режиме "analyst"` },
      { status: 404 },
    );
  }
  // Idempotency guard: the UI hides the button for local tasks, so a
  // second POST means stale UI or a hand-rolled call — refuse rather
  // than silently re-running the git dance.
  if (task.remote !== true) {
    return NextResponse.json(
      { error: "Задача уже является локальной — брать в работу нечего" },
      { status: 409 },
    );
  }
  if (!task.remoteBranch) {
    return NextResponse.json(
      { error: "У задачи не записан remoteBranch — источник неизвестен" },
      { status: 409 },
    );
  }

  let result;
  try {
    // Take the new worktree but leave the read-only mirror on
    // disk — we tear it down AFTER state.json is updated, so a
    // crash between the two steps leaves a consistent state
    // (pointing at the new editable worktree, remote fields
    // cleared) rather than state pointing at a now-missing
    // mirror.
    result = await takeOverRemoteWorktree(
      config.openspecDir,
      task.remoteBranch,
      { removeMirror: false },
    );
  } catch (e) {
    if (e instanceof TakeOverError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: `Не удалось взять задачу в работу: ${String(e)}` },
      { status: 500 },
    );
  }

  // Clearing the remote fields (vs. setting remote:false) actually
  // deletes them from state.json — the remote scan matches on
  // `existing.remote === true`, so once cleared the task is skipped
  // as an ordinary local entry ("leaves a local task untouched").
  const updated = await updateTask("analyst", params.tag, {
    remote: undefined,
    remoteBranch: undefined,
    sourceCommit: undefined,
    publishedBy: undefined,
    openspecWorktreePath: result.worktreePath,
  });

  // State is now authoritative: even if the process dies here
  // we won't end up with a missing mirror + state pointing at
  // it. Best-effort teardown; failures are logged but don't
  // fail the request — the next scan's orphan-cleanup will
  // sweep any leaked mirror directory the next time it
  // discovers the branch is gone upstream.
  try {
    const { removeRemoteReadonlyWorktree } = await import(
      "@/lib/remote-worktree"
    );
    await removeRemoteReadonlyWorktree(config.openspecDir, task.remoteBranch);
  } catch (e) {
    console.warn(
      `[take-over] mirror cleanup failed for ${task.remoteBranch}:`,
      e,
    );
  }

  return NextResponse.json({
    takenOver: true,
    task: updated,
    worktreePath: result.worktreePath,
    branch: result.branch,
    adoptedExisting: result.adoptedExisting,
  });
}
