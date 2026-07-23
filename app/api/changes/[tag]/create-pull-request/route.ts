import { NextRequest, NextResponse } from "next/server";
import { readState } from "@/lib/state";
import { spawnCreatePullRequestGigacode } from "@/lib/continuation";

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
          "Сделать pull request можно только из стадии «Готово» — текущая стадия: " +
          task.stage,
      },
      { status: 409 },
    );
  }
  if (task.mode !== "analyst") {
    return NextResponse.json(
      { error: "Действие доступно только в режиме «Аналитик»" },
      { status: 409 },
    );
  }
  // Gate: branch must already be pushed. Without a push the
  // gigacode --prompt run would still work, but `gh pr create`
  // would error out with "no commits between main and <branch>"
  // — better to fail fast at the API layer with a clear message.
  if (!task.pushedAt) {
    return NextResponse.json(
      {
        error:
          "Сначала опубликуйте ветку — нажмите «Опубликовать ветку» и дождитесь её завершения, потом запускайте pull request",
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
    // Body is optional — the PR template can stand on its own. We
    // just substitute {comments} with an empty string if the user
    // didn't provide any.
    body = {};
  }
  const comments = (body.comments ?? "").trim();

  const result = await spawnCreatePullRequestGigacode(
    task,
    params.tag,
    comments,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json(
    {
      ok: true,
      pullRequest: {
        pid: result.pid,
        logFile: result.logFile,
      },
    },
    { status: 202 },
  );
}