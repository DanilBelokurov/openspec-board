import { NextRequest, NextResponse } from "next/server";
import { readState } from "@/lib/state";
import { runUpdateArtifact } from "@/lib/continuation";

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
  if (task.stage !== "design") {
    return NextResponse.json(
      {
        error:
          "Обновление дизайна доступно только из стадии 'design'",
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

  const result = await runUpdateArtifact(
    task,
    params.tag,
    {
      stage: "design",
      instructionsArtifact: "design",
      artifactSubpath: "design.md",
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