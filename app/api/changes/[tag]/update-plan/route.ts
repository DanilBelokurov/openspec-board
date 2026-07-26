import { NextRequest, NextResponse } from "next/server";
import { findTaskByTagStrict } from "@/lib/state";
import { runUpdateArtifact } from "@/lib/continuation";
import { readConfig } from "@/lib/config";

export async function POST(
  req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const config = await readConfig();
  // Update-plan is developer-mode only. Use the same mode-strict
  // lookup the rest of the dev pipeline uses (no fallback to
  // analyst) — a misconfigured call from the analyst board
  // must not pick up the analyst-companion task here, otherwise
  // we'd be writing to state.tasks["analyst:<tag>"] with
  // plan-shaped fields.
  const task = await findTaskByTagStrict(config.mode, params.tag);
  if (!task) {
    return NextResponse.json(
      {
        error: `Задача "${params.tag}" не найдена в режиме "${config.mode}"`,
      },
      { status: 404 },
    );
  }
  if (task.mode !== "developer" || task.stage !== "plan") {
    return NextResponse.json(
      {
        error:
          "Обновление tasks.md доступно только из стадии 'plan' в режиме разработчика",
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

  let body: { comments?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
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

  // Same shape as the analyst design/adr/delta-spec update
  // endpoints — runUpdateArtifact reads the existing tasks.md,
  // re-fetches openspec instructions, and spawns gigacode
  // --prompt with the user's free-form request folded in. The
  // update uses the same prompt template as the create step
  // (templates/spec-driven/update-artifact-prompt-template.md);
  // only the openspec instructions JSON differs (tasks instead
  // of design/adr/specs).
  const result = await runUpdateArtifact(
    task,
    params.tag,
    {
      stage: "plan",
      instructionsArtifact: "tasks",
      artifactSubpath: "tasks.md",
    },
    comments,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
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
