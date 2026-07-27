import { NextRequest, NextResponse } from "next/server";
import { readState, updateTask, findTaskByTag } from "@/lib/state";
import { readConfig } from "@/lib/config";
import { runUpdateArtifact } from "@/lib/continuation";

/**
 * Stages the analyst can revert back to from a higher stage
 * (including from done). These are the stages that produce a
 * re-writeable artefact (proposal.md / specs/ / design.md /
 * adr.md). Selecting a target stage T:
 *   1. Sets task.stage to T so the artefact for T is re-written
 *      via the cascade-update flow.
 *   2. Spawns a detached gigacode --prompt re-run for T with
 *      the analyst's free-form comment folded into the prompt.
 *   3. Arms the cascade: `cascadeTargetStage = T` (lower bound),
 *      `cascadeFromStage = originalStage` (upper bound), and
 *      `cascadeComment = <comments>`. /confirm will then
 *      automatically re-write every subsequent stage in
 *      [T, originalStage] with the same comment, until the task
 *      leaves that range. After the cascade ends, any artefact
 *      strictly past `cascadeFromStage` is left stale (surfaced
 *      in the UI with a `(*)` marker).
 *
 * Works from any analyst stage, including `done`. There is no
 * wipe — the artefacts are re-written in place by the cascade.
 */
const REOPEN_ALLOWED_STAGES = [
  "proposal",
  "delta-spec",
  "design",
  "adr",
] as const;
type ReopenStage = (typeof REOPEN_ALLOWED_STAGES)[number];

function isReopenStage(value: unknown): value is ReopenStage {
  return (
    typeof value === "string" &&
    (REOPEN_ALLOWED_STAGES as readonly string[]).includes(value)
  );
}

/** All analyst stages in pipeline order, used to validate that
 *  the user can actually revert to a target (target must be
 *  strictly earlier than the stage the task is currently on). */
const STAGE_ORDER = [
  "proposal",
  "delta-spec",
  "design",
  "adr",
  "done",
] as const;

function stageIndex(stage: string): number {
  return STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
}

function isStageEarlier(a: string, b: string): boolean {
  return stageIndex(a) < stageIndex(b);
}

const ARTIFACT_CONFIG_FOR_STAGE: Record<
  ReopenStage,
  {
    instructionsArtifact: "proposal" | "specs" | "design" | "adr";
    artifactSubpath: string;
  }
> = {
  proposal: {
    instructionsArtifact: "proposal",
    artifactSubpath: "proposal.md",
  },
  "delta-spec": {
    instructionsArtifact: "specs",
    artifactSubpath: "specs",
  },
  design: {
    instructionsArtifact: "design",
    artifactSubpath: "design.md",
  },
  adr: {
    instructionsArtifact: "adr",
    artifactSubpath: "adr.md",
  },
};

export async function POST(
  req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const state = await readState();
  // Reopen is analyst-mode only.
  const found = await findTaskByTag(params.tag, "analyst");
  const task = found?.task;
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена` },
      { status: 404 },
    );
  }
  if (task.mode !== "analyst") {
    return NextResponse.json(
      {
        error:
          "Откат реализован только для задач в режиме «Аналитик»",
      },
      { status: 409 },
    );
  }
  if (!task.openspecWorktreePath) {
    return NextResponse.json(
      { error: "У задачи не записан openspecWorktreePath" },
      { status: 400 },
    );
  }

  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Сначала укажите директорию OpenSpec store в настройках" },
      { status: 400 },
    );
  }

  let body: { targetStage?: string; comments?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    );
  }
  if (!isReopenStage(body.targetStage)) {
    return NextResponse.json(
      {
        error: `targetStage должен быть одним из: ${REOPEN_ALLOWED_STAGES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  const comments = (body.comments ?? "").trim();
  if (!comments) {
    return NextResponse.json(
      { error: "Пустой комментарий — нечего отправлять" },
      { status: 400 },
    );
  }

  // Validate that the target stage is strictly earlier than the
  // task's current stage. From proposal there's nowhere to revert
  // to, so the button is hidden in the UI but we defend here too.
  if (!isStageEarlier(body.targetStage, task.stage)) {
    return NextResponse.json(
      {
        error:
          "Целевой этап должен быть строго раньше текущего — текущий: " +
          task.stage,
      },
      { status: 400 },
    );
  }

  // Capture the original stage BEFORE we mutate task.stage — this
  // becomes the upper bound of the cascade (cascadeFromStage).
  const originalStage = task.stage;

  // Reset the task to the target stage and clear per-stage state
  // for every stage at or after the target, so a stale
  // proposal/delta-spec/design/adr PID doesn't leak into the
  // re-write. Cascade fields are armed with the user's comment so
  // /confirm can auto-trigger the next stage's update.
  await updateTask("analyst", params.tag, {
    stage: body.targetStage,
    committedAt: undefined,
    commitExitCode: undefined,
    commitError: undefined,
    proposalUpdatePid: null,
    proposalUpdateStartedAt: undefined,
    proposalUpdateExitCode: undefined,
    proposalUpdateExitSignal: undefined,
    proposalUpdateLogPath: undefined,
    proposalUpdateComments: undefined,
    deltaSpecCommittedAt: undefined,
    deltaSpecCommitExitCode: undefined,
    deltaSpecCommitError: undefined,
    deltaSpecUpdatePid: null,
    deltaSpecUpdateStartedAt: undefined,
    deltaSpecUpdateExitCode: undefined,
    deltaSpecUpdateExitSignal: undefined,
    deltaSpecUpdateLogPath: undefined,
    deltaSpecUpdateComments: undefined,
    designCommittedAt: undefined,
    designCommitExitCode: undefined,
    designCommitError: undefined,
    designUpdatePid: null,
    designUpdateStartedAt: undefined,
    designUpdateExitCode: undefined,
    designUpdateExitSignal: undefined,
    designUpdateLogPath: undefined,
    designUpdateComments: undefined,
    adrCommittedAt: undefined,
    adrCommitExitCode: undefined,
    adrCommitError: undefined,
    adrUpdatePid: null,
    adrUpdateStartedAt: undefined,
    adrUpdateExitCode: undefined,
    adrUpdateExitSignal: undefined,
    adrUpdateLogPath: undefined,
    adrUpdateComments: undefined,
    cascadeTargetStage: body.targetStage,
    cascadeFromStage: originalStage,
    cascadeComment: comments,
  });

  // Spawn the artefact-update gigacode run for the target stage
  // with the user's comment. Subsequent confirms will spawn the
  // cascade-updates for the in-between stages until the task
  // leaves [targetStage, originalStage].
  const result = await runUpdateArtifact(
    task,
    params.tag,
    {
      stage: body.targetStage,
      ...ARTIFACT_CONFIG_FOR_STAGE[body.targetStage],
    },
    comments,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      tag: params.tag,
      targetStage: body.targetStage,
      originalStage,
      cascade: {
        targetStage: body.targetStage,
        fromStage: originalStage,
      },
      update: {
        pid: result.pid,
        logFile: result.logFile,
      },
    },
    { status: 202 },
  );
}