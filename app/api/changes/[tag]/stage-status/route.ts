import { NextResponse } from "next/server";
import { findTaskByTagStrict, requireOpenspecMode } from "@/lib/state";
import { readConfig } from "@/lib/config";
import { isProcessAlive } from "@/lib/process";
import { isStageReady, isPlanTasksReady, STAGE_CONFIG } from "@/lib/continuation";
import { computeStageStatus } from "@/lib/stage-status";

/**
 * Lightweight readiness check for the stage-status polling loop
 * in `components/ConfirmButton.tsx`. After the analyst presses
 * "Подтверждено", the server may immediately spawn a cascade
 * update for the next stage (see `cascade.active === true` in
 * `confirm/route.ts`) — that update writes to disk in the
 * background, and the user is already on the board by the time
 * the artifact appears. We poll this endpoint so the UI can
 * flip "Go to board" without waiting for the next render.
 *
 * `computeStageStatus` mirrors the gating logic in
 * `app/changes/[tag]/page.tsx` so the answer agrees with what
 * the confirm button itself would show on a full re-render.
 */
export async function GET(
  _req: Request,
  { params }: { params: { tag: string } },
) {
  const config = await readConfig();
  const modeGate = requireOpenspecMode(config.mode);
  if (!modeGate.ok) return modeGate.response;
  const taskMode = modeGate.taskMode;
  const task = await findTaskByTagStrict(taskMode, params.tag);
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена в режиме "${config.mode}"` },
      { status: 404 },
    );
  }
  if (!task.openspecWorktreePath) {
    return NextResponse.json(
      { error: "У задачи не записан openspecWorktreePath" },
      { status: 400 },
    );
  }

  const changeName = task.parentTag ?? task.summary.changeName;
  const artifactReady = await checkArtifactReady(
    task.stage,
    task.openspecWorktreePath,
    changeName,
  );
  const status = computeStageStatus(task, isProcessAlive, artifactReady);
  return NextResponse.json(status);
}

async function checkArtifactReady(
  stage: string,
  worktree: string,
  changeName: string,
): Promise<boolean> {
  if (stage === "plan") {
    return isPlanTasksReady(worktree, changeName);
  }
  const config = STAGE_CONFIG[stage];
  if (!config) return false;
  return isStageReady(worktree, changeName, config);
}
