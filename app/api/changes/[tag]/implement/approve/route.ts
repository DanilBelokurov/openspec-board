import { NextRequest, NextResponse } from "next/server";
import { findTaskByTagStrict } from "@/lib/state";
import { readConfig } from "@/lib/config";
import { runGreenTdd } from "@/lib/continuation";
import { isProcessAlive } from "@/lib/process";

/**
 * Human-gated transition from RED to GREEN. The dev has
 * reviewed the tests on the feature branch (they live on
 * GitHub now — the diff view itself is out of scope of our
 * board) and clicked "Подтвердить". This endpoint stamps the
 * approval timestamp and spawns the GREEN-phase
 * `gigacode --prompt` run inside the code-repo worktree.
 *
 * The commit + push of RED's tests is no longer this
 * endpoint's job — `commitAndPushRedTests` in
 * `lib/continuation.ts` runs from the RED exit handler (see
 * `runRedTdd`). The user reviews on GitHub and only then
 * comes back here to approve.
 *
 * Pre-flight:
 *  - task exists on developer board, stage = "develop"
 *  - RED must have completed successfully
 *    (`redPhaseExitCode === 0`)
 *  - RED must NOT have been approved before, OR the previous
 *    approval's commit failed (the old redPhaseCommitError
 *    surface is gone now that commit is auto, but we keep
 *    the re-approve fallback handle for back-compat).
 *  - the auto-commit must have produced a SHA — i.e. RED
 *    wrote something. If RED wrote nothing,
 *    `redPhaseCommitSha` is null and the user needs to
 *    restart RED (no tests → no GREEN).
 *  - the auto-commit must NOT have failed — `Подтвердить`
 *    is blocked until the user restarts RED on a fresh
 *    attempt.
 *  - the auto-push must have succeeded — per the agreed 2B
 *    contract, the dev wants to confirm against the remote
 *    branch before pushing GREEN commits on top of it. If
 *    push failed, the user retries via `/implement/push`.
 *  - no live RED UPDATE process (commit would pick up
 *    partial edits).
 *  - no live GREEN process.
 *
 * On success: 202 Accepted with the gigacode PID and log
 * file. The detail page re-fetches via `router.refresh()`.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const config = await readConfig();
  void config;
  const task = await findTaskByTagStrict("developer", params.tag);
  if (!task) {
    return NextResponse.json(
      {
        error: `Задача "${params.tag}" не найдена в режиме "developer"`,
      },
      { status: 404 },
    );
  }
  if (task.stage !== "develop") {
    return NextResponse.json(
      {
        error:
          "Утверждение TDD доступно только из стадии 'develop' в режиме разработчика",
      },
      { status: 409 },
    );
  }
  if (!task.codeWorktreePath) {
    return NextResponse.json(
      { error: "У задачи не записан codeWorktreePath" },
      { status: 400 },
    );
  }
  if (!task.openspecWorktreePath || !task.parentTag || !task.serviceName) {
    return NextResponse.json(
      {
        error:
          "У задачи нет привязки к parent / service — нельзя запустить GREEN",
      },
      { status: 400 },
    );
  }

  if (task.redPhaseExitCode == null) {
    return NextResponse.json(
      {
        error: "RED-фаза ещё не завершилась — дождитесь окончания",
      },
      { status: 409 },
    );
  }
  if (task.redPhaseExitCode !== 0) {
    return NextResponse.json(
      {
        error: `RED-фаза завершилась с ошибкой (exit ${task.redPhaseExitCode}) — сначала перезапустите RED`,
      },
      { status: 409 },
    );
  }

  // The auto-commit must have produced a SHA — RED wrote
  // something. If RED wrote nothing, `redPhaseCommitSha` is
  // null forever; the user has to restart RED. We do
  // NOT block on a stale commit error here — the auto-commit
  // runs from the RED exit handler and the user can retry
  // the whole RED cycle through the existing restart button.
  if (task.redPhaseCommitError) {
    return NextResponse.json(
      {
        error: `Auto-коммит RED-тестов упал: ${task.redPhaseCommitError} — перезапустите RED`,
      },
      { status: 409 },
    );
  }
  if (task.redPhaseCommitSha == null) {
    return NextResponse.json(
      {
        error:
          "RED не оставил тестов (auto-commit пропущен — нет изменений). Перезапустите RED.",
      },
      { status: 409 },
    );
  }

  // The push must have succeeded — 2B contract. The user
  // reviews on GitHub before approving; if push failed we
  // block approval and let the user retry via
  // /implement/push.
  if (task.redPhasePushError) {
    return NextResponse.json(
      {
        error: `Push ветки упал: ${task.redPhasePushError} — нажмите «Push» чтобы повторить, потом «Подтвердить»`,
      },
      { status: 409 },
    );
  }
  if (task.redPhasePushedAt == null) {
    return NextResponse.json(
      {
        error:
          "Ветка ещё не отправлена в remote — дождитесь окончания push или нажмите «Push» для retry",
      },
      { status: 409 },
    );
  }

  // Stamped-approval idempotency. A duplicate /implement/approve
  // POST (e.g. a flaky network retry) hits this check and
  // 409s out. The old "commit error → re-approve" path is
  // gone now (commit is auto); the `redPhaseCommitError`
  // block above already surfaces the failure and the user
  // restarts RED instead.
  if (task.redPhaseApprovedAt != null) {
    return NextResponse.json(
      {
        error:
          "Тесты уже утверждены — дождитесь окончания GREEN или смотрите логи",
      },
      { status: 409 },
    );
  }

  if (task.greenPhasePid && isProcessAlive(task.greenPhasePid)) {
    return NextResponse.json(
      {
        error: "GREEN-фаза уже выполняется — дождитесь окончания",
      },
      { status: 409 },
    );
  }
  // Don't approve while a RED UPDATE is still rewriting the
  // tests in the working tree — the next push/commit would
  // pick up partial edits. The ReviewReadyCard already hides
  // its action buttons during the update so the user can't
  // approve from the UI either; this is the server-side
  // belt-and-suspenders.
  if (task.redPhaseUpdatePid && isProcessAlive(task.redPhaseUpdatePid)) {
    return NextResponse.json(
      {
        error:
          "Идёт обновление RED-тестов — дождитесь окончания, потом «Подтвердить»",
      },
      { status: 409 },
    );
  }

  // Stamp the approval timestamp, then spawn GREEN. The
  // two operations are not atomic, but the order matters:
  // if /implement/approve is called twice in quick
  // succession (e.g. a flaky network retry), the second
  // call would hit the redPhaseApprovedAt check above and
  // 409 out — preventing a double GREEN spawn that would
  // clobber the worktree.
  const { updateTask } = await import("@/lib/state");
  await updateTask("developer", params.tag, {
    redPhaseApprovedAt: new Date().toISOString(),
  });

  const result = await runGreenTdd(task, params.tag);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(
    {
      ok: true,
      pid: result.pid,
      logFile: result.logFile,
    },
    { status: 202 },
  );
}
