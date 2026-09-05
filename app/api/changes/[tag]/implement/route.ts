import { NextRequest, NextResponse } from "next/server";
import { readState, findTaskByTagStrict } from "@/lib/state";
import { readConfig } from "@/lib/config";
import { runRedTdd } from "@/lib/continuation";
import { isProcessAlive } from "@/lib/process";

/**
 * Spawn the per-service TDD RED phase `gigacode --prompt` run
 * for a child task in the developer-mode "develop" stage. RED
 * writes one failing test per task in `tasks/<service>/tasks.md`
 * and commits each. The detail page re-fetches on 2xx so the
 * new RED process card appears; once RED is done and the dev
 * has approved the tests, the page shows a diff card with a
 * "Подтвердить" button that POSTs to
 * `/api/changes/<tag>/implement/approve` to spawn the GREEN
 * phase.
 *
 * Pre-flight:
 *  - the task must exist on the developer board
 *  - the task's stage must be "develop"
 *  - no live RED process (redPhasePid still alive)
 *  - no already-completed RED awaiting approval
 *    (redPhaseExitCode === 0 && !redPhaseApprovedAt) —
 *    we surface this as a 409 so the dev can't accidentally
 *    double-spawn and overwrite their test diff
 *  - parent task must still exist (so the LLM can read
 *    tasks.md)
 *  - both `codeWorktreePath` and `openspecWorktreePath` must
 *    be set
 *
 * On success: 202 Accepted with the gigacode PID and log
 * file. The exit code is written back to the task's
 * `redPhaseExitCode` field asynchronously when the
 * detached process ends. The detail page re-fetches via
 * `router.refresh()` and shows the new state in a process
 * card.
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
          "Запуск TDD доступен только из стадии 'develop' в режиме разработчика",
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
          "У задачи нет привязки к parent / service — нельзя запустить TDD",
      },
      { status: 400 },
    );
  }

  // Idempotency: refuse a second spawn while a previous RED
  // run is still alive.
  if (task.redPhasePid && isProcessAlive(task.redPhasePid)) {
    return NextResponse.json(
      {
        error:
          "Предыдущая RED-итерация ещё выполняется — дождитесь завершения",
      },
      { status: 409 },
    );
  }

  // Refuse re-spawn if a completed RED is sitting in the
  // approval gate — the dev's path forward is either to
  // click "Подтвердить" (→ /implement/approve) or to ask
  // gigacode to re-run the RED phase via the pencil update
  // on tasks.md. Re-running RED directly here would
  // silently overwrite the test diff they're reviewing.
  if (
    task.redPhaseExitCode === 0 &&
    task.redPhaseApprovedAt == null
  ) {
    return NextResponse.json(
      {
        error:
          "Тесты RED-фазы уже написаны и ожидают утверждения — нажмите «Подтвердить»",
      },
      { status: 409 },
    );
  }

  const state = await readState();
  const parentKey = `developer:${task.parentTag}`;
  if (!state.tasks[parentKey]) {
    return NextResponse.json(
      {
        error: `Родительская задача "${task.parentTag}" не найдена`,
      },
      { status: 404 },
    );
  }

  const result = await runRedTdd(task, params.tag);
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
