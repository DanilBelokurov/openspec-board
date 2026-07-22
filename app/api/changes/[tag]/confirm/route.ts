import path from "path";
import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { readState, updateTask } from "@/lib/state";
import { commitChange, isStageReady } from "@/lib/continuation";

// Each confirm call is gated on the previous stage being ready
// (artifact on disk). The "next stage" key is what we advance the
// task to on success.
const NEXT_STAGE: Record<string, string> = {
  proposal: "delta-spec",
  "delta-spec": "design",
  design: "adr",
  adr: "done",
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function POST(
  _req: NextRequest,
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
  const nextStage = NEXT_STAGE[task.stage];
  if (!nextStage) {
    return NextResponse.json(
      {
        error: `Задача в статусе "${task.stage}" — подтверждение не предусмотрено`,
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

  // Confirm is gated on the artifact for the current stage existing
  // on disk; the comment-error path covers cases where gigacode
  // didn't manage to write the artifact (or wrote something other
  // than what we expected).
  const worktree = task.openspecWorktreePath;
  const changePath = path.join(worktree, "openspec", "changes", params.tag);
  const artifactReady = await checkStageArtifact(
    task.stage,
    worktree,
    params.tag,
  );
  if (!artifactReady) {
    return NextResponse.json(
      {
        error: `Артефакт ещё не создан — ожидаем ${expectedArtifactPath(task.stage, changePath)}`,
      },
      { status: 409 },
    );
  }

  // Commit first; if it fails we leave stage alone so the user can
  // retry after fixing git config (per the commit-on-confirm gate
  // discussed in the confirm-rework).
  const ok = await commitChange(task, params.tag, task.stage);
  if (!ok) {
    // Re-read state to surface the latest commitError that
    // commitChange wrote into state.json.
    const refreshed = await readState();
    const errMsg =
      refreshed.tasks[params.tag]?.commitError ??
      refreshed.tasks[params.tag]?.deltaSpecCommitError ??
      refreshed.tasks[params.tag]?.designCommitError ??
      refreshed.tasks[params.tag]?.adrCommitError ??
      "Не удалось сделать git commit";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }

  // Advance to the next analyst-mode stage. The auto-trigger loop
  // in lib/continuation.ts will pick up the new stage on the next
  // render / tick and spawn the next gigacode pipeline.
  const updated = await updateTask(params.tag, {
    stage: nextStage as import("@/lib/openspec").Stage,
  });
  return NextResponse.json({ ok: true, task: updated });
}

function expectedArtifactPath(stage: string, changePath: string): string {
  if (stage === "delta-spec") return `${changePath}/specs/`;
  if (stage === "proposal") return `${changePath}/proposal.md`;
  if (stage === "design") return `${changePath}/design.md`;
  if (stage === "adr") return `${changePath}/docs/adr/`;
  return changePath;
}

async function checkStageArtifact(
  stage: string,
  worktree: string,
  changeName: string,
): Promise<boolean> {
  if (stage === "delta-spec") {
    return isStageReady(worktree, changeName, {
      stage: "delta-spec",
      instructionsArtifact: "specs",
      artifactSubpath: "specs",
    });
  }
  if (stage === "proposal") {
    return exists(
      path.join(worktree, "openspec", "changes", changeName, "proposal.md"),
    );
  }
  if (stage === "design") {
    return exists(
      path.join(worktree, "openspec", "changes", changeName, "design.md"),
    );
  }
  if (stage === "adr") {
    return isStageReady(worktree, changeName, {
      stage: "adr",
      instructionsArtifact: "adr",
      artifactSubpath: "docs/adr",
    });
  }
  return false;
}