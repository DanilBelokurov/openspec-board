import { NextRequest, NextResponse } from "next/server";
import { readState, updateTask } from "@/lib/state";
import { readConfig } from "@/lib/config";
import { runUpdateArtifact } from "@/lib/continuation";
import { deleteArtefactsAfterStage } from "@/lib/git-cleanup-artifacts";

/**
 * Stages the analyst can revert a done task back to. These are
 * the stages that produce a re-writeable artefact (proposal.md /
 * specs/ / design.md / adr.md). Selecting a stage:
 *   1. Sets task.stage back to that stage so the auto pipeline
 *      will re-generate the artefact on the next watcher tick.
 *   2. Deletes every artefact produced by a stage at or after
 *      the selected one (the selected stage's own artefact
 *      included, so the re-write starts from scratch).
 *   3. Spawns a detached gigacode --prompt re-run for the
 *      selected stage with the analyst's free-form comment
 *      folded into the prompt (templates/spec-driven/update-*).
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
  const task = state.tasks[params.tag];
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена` },
      { status: 404 },
    );
  }
  if (task.stage !== "done") {
    return NextResponse.json(
      {
        error:
          "Откатить можно только задачу в стадии 'done' — текущая стадия: " +
          task.stage,
      },
      { status: 409 },
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

  // 1) Wipe the artefacts produced by every stage at or after the
  //    selected one. The selected stage's own artefact is wiped so
  //    the re-write starts from a clean slate.
  const removed = await deleteArtefactsAfterStage(
    task.openspecWorktreePath,
    params.tag,
    body.targetStage,
  );

  // 2) Reset task stage so triggerContinueIfNeeded / the watcher
  //    see the new stage and the per-stage Create/Update PIDs are
  //    all cleared (we don't want a stale proposal PID to leak
  //    into the delta-spec run after a revert).
  await updateTask(params.tag, {
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
  });

  // 3) Spawn the artifact-update gigacode run with the analyst's
  //    free-form comment folded in. runUpdateArtifact returns the
  //    spawned PID; the watcher will pick up the exit code and
  //    the next user confirm will commit the new artefact.
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
      removed,
      update: {
        pid: result.pid,
        logFile: result.logFile,
      },
    },
    { status: 202 },
  );
}