import path from "path";
import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { readState, updateTask } from "@/lib/state";
import { commitProposalChange } from "@/lib/continuation";

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
  if (task.stage !== "proposal") {
    return NextResponse.json(
      {
        error: `Задача в статусе "${task.stage}" — подтверждение доступно только из "proposal"`,
      },
      { status: 409 },
    );
  }

  // Commit happens here, gated on the user's explicit "Подтверждаю"
  // press — NOT in the auto-trigger loop in lib/continuation.ts.
  // We commit first, then advance stage; if the commit fails we leave
  // stage at "proposal" and surface the error so the user can retry
  // (e.g. after fixing git config) without losing their place.
  if (task.openspecWorktreePath) {
    const changePath = path.join(
      task.openspecWorktreePath,
      "openspec",
      "changes",
      params.tag,
    );
    const proposalExists = await exists(path.join(changePath, "proposal.md"));
    if (!proposalExists) {
      return NextResponse.json(
        {
          error:
            "Файл proposal.md ещё не создан — генерация proposal не завершена",
        },
        { status: 409 },
      );
    }
    if (!task.committedAt) {
      const ok = await commitProposalChange(task, params.tag);
      if (!ok) {
        // Re-read state to surface the latest commitError that
        // commitProposalChange wrote into state.json.
        const refreshed = await readState();
        const errMsg =
          refreshed.tasks[params.tag]?.commitError ??
          "Не удалось сделать git commit";
        return NextResponse.json({ error: errMsg }, { status: 500 });
      }
    }
  }

  // Advance to the next analyst-mode stage (delta-spec). Subsequent
  // /opsx-continue invocations will create the delta-spec files.
  const updated = await updateTask(params.tag, { stage: "delta-spec" });
  return NextResponse.json({ ok: true, task: updated });
}