import { NextRequest, NextResponse } from "next/server";
import { readState, updateTask } from "@/lib/state";

export async function POST(
  _req: NextRequest,
  { params }: { params: { name: string } },
) {
  const state = await readState();
  const task = state.tasks[params.name];
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.name}" не найдена` },
      { status: 404 },
    );
  }
  if (task.stage !== "proposal") {
    return NextResponse.json(
      { error: `Задача в статусе "${task.stage}" — подтверждение доступно только из "proposal"` },
      { status: 409 },
    );
  }

  // Advance to the next analyst-mode stage (delta-spec). Subsequent
  // /opsx-continue invocations will create the delta-spec files.
  const updated = await updateTask(params.name, { stage: "delta-spec" });
  return NextResponse.json({ ok: true, task: updated });
}