import { NextRequest, NextResponse } from "next/server";
import { readState, findTaskByTag, updateTask } from "@/lib/state";
import { runUpdateArtifact } from "@/lib/continuation";

export async function POST(
  req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const state = await readState();
  // Update-delta-spec is analyst-mode only.
  const found = await findTaskByTag(params.tag, "analyst");
  const task = found?.task;
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена` },
      { status: 404 },
    );
  }
  if (task.stage !== "delta-spec") {
    return NextResponse.json(
      {
        error:
          "Обновление дельта-спецификации доступно только из стадии 'delta-spec'",
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
  // Remote tasks are read-only mirrors — pencil-updates must not
  // rewrite the author's published artifacts.
  if (task.remote === true) {
    return NextResponse.json(
      { error: "Задача опубликована другим пользователем — редактирование недоступно" },
      { status: 403 },
    );
  }

  // Manual pencil cancels any active cascade AND clears the
  // stale-marker state (cascadeFromStage) if the cascade has
  // already ended — the user's targeted edit takes priority
  // over the auto-triggered cascade-updates.
  if (
    task.cascadeComment ||
    task.cascadeFromStage ||
    task.cascadeTargetStage
  ) {
    await updateTask("analyst", params.tag, {
      cascadeTargetStage: undefined,
      cascadeFromStage: undefined,
      cascadeComment: undefined,
    });
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

  const result = await runUpdateArtifact(task, params.tag, {
    stage: "delta-spec",
    instructionsArtifact: "specs",
    artifactSubpath: "specs",
  }, comments);
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