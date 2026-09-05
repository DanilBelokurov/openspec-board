import { NextRequest, NextResponse } from "next/server";
import { findTaskByTagStrict } from "@/lib/state";
import { runGreenTdd, runRedTdd } from "@/lib/continuation";
import { isProcessAlive } from "@/lib/process";

/**
 * Restart a failed TDD sub-task (RED or GREEN) for a child develop
 * task. Distinct from `/implement` (which starts RED for the first
 * time and refuses to re-spawn when a previous RED is already
 * finished but awaiting approval) and from `/implement/approve`
 * (which stamps the human "Подтвердить" gate and refuses every
 * second call). The restart action is a recovery path: it only
 * fires when the previous run actually failed, and it does not
 * touch the approval timestamp, so the human gate is preserved.
 *
 * Body: `{"phase": "red" | "green"}`.
 *
 * Pre-flight for `phase = "red"`:
 *  - task exists on developer board, stage = "develop"
 *  - codeWorktreePath / openspecWorktreePath / parentTag /
 *    serviceName set
 *  - no live RED process (redPhasePid still alive)
 *  - RED was NOT approved (redPhaseApprovedAt == null) — the
 *    recovery path for an approved-but-subsequently-failed RED
 *    is to restart GREEN, not RED
 *  - RED actually failed (exitCode != null && exitCode !== 0)
 *
 * Pre-flight for `phase = "green"`:
 *  - task exists on developer board, stage = "develop"
 *  - codeWorktreePath / openspecWorktreePath / parentTag /
 *    serviceName set
 *  - RED completed successfully (exitCode === 0)
 *  - RED was approved (redPhaseApprovedAt != null)
 *  - no live GREEN process
 *  - GREEN actually failed (exitCode != null && exitCode !== 0)
 *
 * On success: 202 Accepted with the gigacode PID and log file,
 * mirroring the shape of `/implement` and `/implement/approve`.
 * The detail page re-fetches via `router.refresh()` and the
 * process card flips back to the live-spinner state.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const task = await findTaskByTagStrict("developer", params.tag);
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена в режиме "developer"` },
      { status: 404 },
    );
  }
  if (task.stage !== "develop") {
    return NextResponse.json(
      {
        error:
          "Перезапуск TDD доступен только из стадии 'develop' в режиме разработчика",
      },
      { status: 409 },
    );
  }
  if (
    !task.codeWorktreePath ||
    !task.openspecWorktreePath ||
    !task.parentTag ||
    !task.serviceName
  ) {
    return NextResponse.json(
      {
        error:
          "У задачи нет привязки к worktree / parent / service — нельзя перезапустить TDD",
      },
      { status: 400 },
    );
  }

  let body: { phase?: string } = {};
  try {
    body = (await req.json()) as { phase?: string };
  } catch {
    body = {};
  }
  const phase = body.phase;
  if (phase !== "red" && phase !== "green") {
    return NextResponse.json(
      {
        error: "Параметр 'phase' должен быть 'red' или 'green'",
      },
      { status: 400 },
    );
  }

  if (phase === "red") {
    if (task.redPhasePid && isProcessAlive(task.redPhasePid)) {
      return NextResponse.json(
        { error: "RED-фаза ещё выполняется — дождитесь завершения" },
        { status: 409 },
      );
    }
    if (task.redPhaseApprovedAt != null) {
      return NextResponse.json(
        {
          error:
            "RED-фаза уже утверждена — перезапускать нужно GREEN-фазу",
        },
        { status: 409 },
      );
    }
    if (task.redPhaseExitCode == null || task.redPhaseExitCode === 0) {
      return NextResponse.json(
        {
          error:
            "RED-фаза не завершилась с ошибкой — перезапуск не требуется",
        },
        { status: 409 },
      );
    }

    const result = await runRedTdd(task, params.tag);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json(
      { ok: true, pid: result.pid, logFile: result.logFile },
      { status: 202 },
    );
  }

  // phase === "green"
  if (task.redPhaseExitCode !== 0) {
    return NextResponse.json(
      {
        error:
          "RED-фаза не была успешно завершена — сначала перезапустите RED",
      },
      { status: 409 },
    );
  }
  if (task.redPhaseApprovedAt == null) {
    return NextResponse.json(
      {
        error:
          "RED-фаза ещё не утверждена — нажмите «Подтвердить» вместо перезапуска GREEN",
      },
      { status: 409 },
    );
  }
  if (task.greenPhasePid && isProcessAlive(task.greenPhasePid)) {
    return NextResponse.json(
      { error: "GREEN-фаза ещё выполняется — дождитесь завершения" },
      { status: 409 },
    );
  }
  if (task.greenPhaseExitCode == null || task.greenPhaseExitCode === 0) {
    return NextResponse.json(
      {
        error:
          "GREEN-фаза не завершилась с ошибкой — перезапуск не требуется",
      },
      { status: 409 },
    );
  }

  const result = await runGreenTdd(task, params.tag);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(
    { ok: true, pid: result.pid, logFile: result.logFile },
    { status: 202 },
  );
}
