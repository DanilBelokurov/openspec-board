import { NextRequest, NextResponse } from "next/server";
import { readState, findTaskByTagStrict } from "@/lib/state";
import { readConfig } from "@/lib/config";
import { runImplementTdd } from "@/lib/continuation";
import { isProcessAlive } from "@/lib/process";

/**
 * Spawn the per-service TDD `gigacode --prompt` run for a
 * child task in the developer-mode "develop" stage. The URL
 * path segment is the child tag — the service-name directory
 * under the parent's `tasks/`.
 *
 * Pre-flight:
 *  - the task must exist on the developer board
 *  - the task's stage must be "develop"
 *  - no live implement process (implementPid still alive)
 *  - parent task must exist (so the LLM can read its tasks.md)
 *  - both `codeWorktreePath` (created by /confirm) and
 *    `openspecWorktreePath` (inherited from the parent) must
 *    be set
 *
 * On success: 202 Accepted with the gigacode PID and log
 * file. The exit code is written back to the task's
 * `implementExitCode` field asynchronously when the
 * detached process ends. The detail page re-fetches via
 * `router.refresh()` and shows the new state in a process
 * card identical to the design/adr `planCreatePid` card.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { tag: string } },
) {
  // Mode-strict lookup: the implement endpoint is
  // developer-mode only. We still read config to fail fast on
  // misconfigured calls (e.g. from the analyst board).
  const config = await readConfig();
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

  // Idempotency: refuse a second spawn while a previous
  // implement run is still alive. PIDs are per-child.
  if (task.implementPid && isProcessAlive(task.implementPid)) {
    return NextResponse.json(
      {
        error:
          "Предыдущая TDD-итерация ещё выполняется — дождитесь завершения",
      },
      { status: 409 },
    );
  }

  // Parent must still exist (the analyst flow could in
  // theory archive it; we don't want to leave an orphan
  // TDD run referencing a non-existent parent).
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

  // Defensive: if the user just clicked and the previous
  // run had a non-null exit code (success or fail), we
  // happily spawn a new one — `runImplementTdd` will overwrite
  // the implement* fields. We don't gate on implementExitCode
  // because the spec is "if the previous run is still
  // running, refuse" (handled by the isProcessAlive check).
  void config;

  const result = await runImplementTdd(task, params.tag);
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
