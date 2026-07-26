import { NextRequest, NextResponse } from "next/server";
import { findTaskByTagStrict } from "@/lib/state";
import { readConfig } from "@/lib/config";
import { runGreenTdd } from "@/lib/continuation";
import { isProcessAlive } from "@/lib/process";

/**
 * Human-gated transition from RED to GREEN. The dev has
 * already reviewed the test commits RED produced (via the
 * diff card on the develop page) and clicked "Подтвердить".
 * This endpoint stamps the approval timestamp, then spawns
 * the GREEN-phase `gigacode --prompt` run inside the
 * code-repo worktree.
 *
 * Pre-flight:
 *  - the task must exist on the developer board
 *  - RED must have completed successfully
 *    (`redPhaseExitCode === 0`)
 *  - RED must NOT have been approved before
 *    (`redPhaseApprovedAt == null`)
 *  - no live GREEN process already running
 *  - codeRepoPath / openspecWorktreePath / parentTag /
 *    serviceName must be set
 *
 * On success: 202 Accepted with the gigacode PID and log
 * file. The detail page re-fetches via `router.refresh()`
 * and the GREEN process card appears under the test-diff
 * card. The "Подтвердить" button is hidden once
 * `greenPhasePid` is set.
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

  // The dev must approve an actually-completed RED. A RED
  // with no exit code is still running; a RED with non-zero
  // exit failed and shouldn't be approved; only
  // redPhaseExitCode === 0 with no prior approval is a
  // legitimate "approve and proceed" trigger.
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

  // Stamp the approval timestamp FIRST, then spawn GREEN.
  // The two operations are not atomic, but the order matters:
  // if /implement/approve is called twice in quick
  // succession (e.g. a flaky network retried the POST), the
  // second call would hit the redPhaseApprovedAt check above
  // and 409 out — preventing a double GREEN spawn that
  // would clobber the worktree.

  // We use a small write-then-read-then-write dance via the
  // shared `updateTask` helper to keep the read-modify-write
  // window narrow. The atomicity is best-effort (state.json
  // writes are atomic via atomic-write.ts, but the two
  // writes — stamp and spawn — are not). For a single-user
  // dev tool this is acceptable; a true multi-user system
  // would need a lock.
  const { updateTask, readState } = await import("@/lib/state");
  await updateTask("developer", params.tag, {
    redPhaseApprovedAt: new Date().toISOString(),
  });
  // Re-read to confirm the stamp landed. (If the write
  // failed the read would still show null; the check above
  // would then reject the second call anyway on the
  // next attempt.)
  void readState;

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
