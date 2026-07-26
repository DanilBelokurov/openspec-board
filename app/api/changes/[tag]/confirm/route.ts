import path from "path";
import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import {
  readState,
  updateTask,
  findTaskByTagStrict,
  taskKey,
} from "@/lib/state";
import {
  commitChange,
  isStageReady,
  isPlanTasksReady,
} from "@/lib/continuation";
import { readConfig } from "@/lib/config";

// Each confirm call is gated on the previous stage being ready
// (artifact on disk). The "next stage" key is what we advance the
// task to on success.
const NEXT_STAGE: Record<string, string> = {
  proposal: "delta-spec",
  "delta-spec": "design",
  design: "adr",
  adr: "done",
  // Developer-mode plan → develop. The plan stage has its own
  // git-commit flow but the post-commit pipeline (develop / tests
  // / deploy) is human-driven rather than gigacode-driven, so the
  // auto-trigger loop in lib/continuation.ts has nothing to spawn
  // here.
  plan: "develop",
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
  // Confirm is mode-aware but mode-strict: we read the current
  // board mode from config and look up the task in that mode
  // only. We never probe the other mode — that would either
  // re-introduce the cross-mode leak findTaskByTag had, or
  // (worse) pick up an analyst-companion task in a terminal
  // stage like "done" and refuse the confirm with 409 even
  // though the developer task in the same tag is sitting there
  // waiting to be confirmed. The mode is determined by the
  // board the user is on, same as page.tsx does it.
  const config = await readConfig();
  const task = await findTaskByTagStrict(config.mode, params.tag);
  if (!task) {
    return NextResponse.json(
      {
        error: `Задача "${params.tag}" не найдена в режиме "${config.mode}"`,
      },
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
    // commitChange wrote into state.json. Look up the task in
    // whatever mode it actually lives in — for plan (developer
    // mode) the error lives on planCommitError, not on the
    // analyst-mode fields the old code hardcoded.
    const refreshed = await readState();
    const modeKey = taskKey(task.mode, params.tag);
    const refreshedTask = refreshed.tasks[modeKey];
    const errMsg =
      refreshedTask?.commitError ??
      refreshedTask?.deltaSpecCommitError ??
      refreshedTask?.designCommitError ??
      refreshedTask?.adrCommitError ??
      refreshedTask?.planCommitError ??
      "Не удалось сделать git commit";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }

  // Advance to the next stage. The auto-trigger loop in
  // lib/continuation.ts will pick up the new stage on the next
  // render / tick and spawn the next gigacode pipeline (no-op
  // for the develop / tests / deploy stages that follow plan —
  // they have no STAGE_CONFIG entry).
  const updated = await updateTask(task.mode, params.tag, {
    stage: nextStage as import("@/lib/openspec").Stage,
  });
  return NextResponse.json({ ok: true, task: updated });
}

function expectedArtifactPath(stage: string, changePath: string): string {
  if (stage === "delta-spec") return `${changePath}/specs/`;
  if (stage === "proposal") return `${changePath}/proposal.md`;
  if (stage === "design") return `${changePath}/design.md`;
  if (stage === "adr") return `${changePath}/adr.md`;
  // tasks.md may be at the change folder root or under a
  // per-service subdirectory (tasks/<service>/tasks.md, the
  // layout the openspec instructions `tasks` subcommand emits).
  if (stage === "plan") return `${changePath}/ (tasks.md, в т.ч. под tasks/<service>/)`;
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
    return exists(
      path.join(worktree, "openspec", "changes", changeName, "adr.md"),
    );
  }
  if (stage === "plan") {
    // tasks.md may live at <change>/tasks.md (single-service
    // change) or <change>/tasks/<service>/tasks.md
    // (multi-service, the layout the openspec instructions
    // `tasks` subcommand emits for this project). Either
    // counts as "ready".
    return isPlanTasksReady(worktree, changeName);
  }
  return false;
}