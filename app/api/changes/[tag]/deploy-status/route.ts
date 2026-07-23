import { NextResponse } from "next/server";
import { readState } from "@/lib/state";
import { isProcessAlive } from "@/lib/process";

/**
 * Return the push + pull-request sub-step state for a single
 * task. Used by DoneDeploymentActions to render the
 * collapsible 'Опубликовать ветку' / 'Создание pull request'
 * cards on the detail page.
 */
export async function GET(
  _req: Request,
  { params }: { params: { tag: string } },
) {
  const state = await readState();
  const task = state.tasks[params.tag];
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена` },
      { status: 404 },
    );
  }
  return NextResponse.json({
    pushedAt: task.pushedAt ?? null,
    pushPid: task.pushPid ?? null,
    pushExitCode: task.pushExitCode ?? null,
    pushError: task.pushError ?? null,
    pushLogPath: task.pushLogPath ?? null,
    pushRemoteUrl: task.pushRemoteUrl ?? null,
    pushAlive:
      task.pushPid != null && task.pushExitCode == null
        ? isProcessAlive(task.pushPid)
        : false,
    pullRequestPid: task.pullRequestPid ?? null,
    pullRequestExitCode: task.pullRequestExitCode ?? null,
    pullRequestError: task.pullRequestError ?? null,
    pullRequestLogPath: task.pullRequestLogPath ?? null,
    pullRequestUrl: task.pullRequestUrl ?? null,
    pullRequestAlive:
      task.pullRequestPid != null && task.pullRequestExitCode == null
        ? isProcessAlive(task.pullRequestPid)
        : false,
  });
}