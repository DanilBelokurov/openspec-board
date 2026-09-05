import { NextResponse } from "next/server";
import { readState, findTaskByTag, updateTask } from "@/lib/state";
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
  // Deploy-status returns push + PR sub-step state — those
  // fields only exist on analyst-mode tasks. Look up the
  // analyst entry directly.
  const found = await findTaskByTag(params.tag, "analyst");
  const task = found?.task;
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена` },
      { status: 404 },
    );
  }

  // Self-heal: the background watcher (lib/watcher.ts) is the
  // canonical place where `pushedAt` / `pullRequestExitCode`
  // get written once the underlying PID dies. But the watcher
  // polls every 5s and `git push` finishes in ~1.2s — so the
  // first deploy-status poll after the push button often beats
  // the watcher's next tick. If the PID is already gone, do
  // the writeup here, synchronously, so the UI flips state in
  // the same round-trip instead of waiting up to 5 seconds
  // (or indefinitely, if the watcher was never started — the
  // bug that motivated this handler). Idempotent: the
  // watcher's later tick sees exitCode already set and skips.
  let healed = task;
  if (
    healed.pushPid != null &&
    healed.pushExitCode == null &&
    !isProcessAlive(healed.pushPid)
  ) {
    const updated = await updateTask("analyst", params.tag, {
      pushExitCode: 0,
      pushExitSignal: null,
      pushedAt: new Date().toISOString(),
    });
    if (updated) healed = updated;
  }
  if (
    healed.pullRequestPid != null &&
    healed.pullRequestExitCode == null &&
    !isProcessAlive(healed.pullRequestPid)
  ) {
    const updated = await updateTask("analyst", params.tag, {
      pullRequestExitCode: 0,
      pullRequestExitSignal: null,
    });
    if (updated) healed = updated;
  }
  // Same self-heal for the sdd-label gigacode spawn: the
  // gigacode process is short-lived and the watcher polls
  // every 5s, so the first deploy-status poll after the
  // button click often beats the watcher's next tick.
  if (
    healed.sddLabelPid != null &&
    healed.sddLabelExitCode == null &&
    !isProcessAlive(healed.sddLabelPid)
  ) {
    const updated = await updateTask("analyst", params.tag, {
      sddLabelExitCode: 0,
      sddLabelExitSignal: null,
      sddLabelAppliedAt: new Date().toISOString(),
    });
    if (updated) healed = updated;
  }

  return NextResponse.json({
    pushedAt: healed.pushedAt ?? null,
    pushPid: healed.pushPid ?? null,
    pushExitCode: healed.pushExitCode ?? null,
    pushError: healed.pushError ?? null,
    pushLogPath: healed.pushLogPath ?? null,
    pushRemoteUrl: healed.pushRemoteUrl ?? null,
    pushAlive:
      healed.pushPid != null && healed.pushExitCode == null
        ? isProcessAlive(healed.pushPid)
        : false,
    pullRequestPid: healed.pullRequestPid ?? null,
    pullRequestExitCode: healed.pullRequestExitCode ?? null,
    pullRequestError: healed.pullRequestError ?? null,
    pullRequestLogPath: healed.pullRequestLogPath ?? null,
    pullRequestUrl: healed.pullRequestUrl ?? null,
    pullRequestAlive:
      healed.pullRequestPid != null && healed.pullRequestExitCode == null
        ? isProcessAlive(healed.pullRequestPid)
        : false,
    sddLabelPid: healed.sddLabelPid ?? null,
    sddLabelExitCode: healed.sddLabelExitCode ?? null,
    sddLabelError: healed.sddLabelError ?? null,
    sddLabelLogPath: healed.sddLabelLogPath ?? null,
    sddLabelAppliedAt: healed.sddLabelAppliedAt ?? null,
    sddLabelAlive:
      healed.sddLabelPid != null && healed.sddLabelExitCode == null
        ? isProcessAlive(healed.sddLabelPid)
        : false,
  });
}