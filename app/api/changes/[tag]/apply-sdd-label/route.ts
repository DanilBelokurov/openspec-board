import { NextRequest, NextResponse } from "next/server";
import { findTaskByTag } from "@/lib/state";
import { extractJiraId } from "@/lib/jira";
import { spawnApplySddLabelGigacode } from "@/lib/continuation";

export async function POST(
  req: NextRequest,
  { params }: { params: { tag: string } },
) {
  // Apply-sdd-label is analyst-mode only.
  const found = await findTaskByTag(params.tag, "analyst");
  const task = found?.task;
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
          "Поставить метку sdd можно только из стадии «Готово» — текущая стадия: " +
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
  // Gate: PR must already be created (mirrors the pushedAt
  // gate on /create-pull-request). The sdd label means
  // «передано в ревью», so applying it before the PR exists
  // would be premature and would create a misleading state
  // in Jira.
  if (task.pullRequestExitCode !== 0) {
    return NextResponse.json(
      {
        error:
          "Сначала создайте pull request — нажмите «Сделать pull request» и дождитесь его завершения, потом запускайте метку sdd",
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
  // Remote tasks are read-only mirrors — labels belong to the author.
  if (task.remote === true) {
    return NextResponse.json(
      { error: "Задача опубликована другим пользователем — действие недоступно" },
      { status: 403 },
    );
  }
  if (!task.jiraUrl) {
    return NextResponse.json(
      {
        error:
          "У задачи не записан jiraUrl — добавьте строку «Jira: ENG-123» в proposal.md",
      },
      { status: 409 },
    );
  }
  if (!extractJiraId(task.jiraUrl)) {
    return NextResponse.json(
      {
        error: `Не удалось извлечь Jira-ключ из ${task.jiraUrl}`,
      },
      { status: 409 },
    );
  }

  let body: { comments?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional — the template substitutes {comments}
    // with an empty string when the analyst didn't provide any.
    body = {};
  }
  const comments = (body.comments ?? "").trim();

  const result = await spawnApplySddLabelGigacode(
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
      sddLabel: {
        pid: result.pid,
        logFile: result.logFile,
      },
    },
    { status: 202 },
  );
}
