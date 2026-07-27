import { NextRequest, NextResponse } from "next/server";
import { findTaskByTagStrict } from "@/lib/state";
import { runRedUpdateTdd } from "@/lib/continuation";
import { isProcessAlive } from "@/lib/process";

const MIN_COMMENTS_LENGTH = 3;
const MAX_COMMENTS_LENGTH = 5000;

/**
 * Spawn a RED UPDATE — re-run the RED phase with a user-supplied
 * comment. Triggered by the pencil button on the TestDiffCard
 * when the dev isn't happy with the tests RED wrote and wants to
 * ask the agent to revise them. Distinct from:
 *
 *  - `/implement` — start a fresh RED on a never-run task.
 *  - `/implement/approve` — commit the tests, spawn GREEN.
 *  - `/implement/restart` — re-run RED without a comment when
 *    the previous attempt failed (exit 0 wasn't reached).
 *
 * Body: `{"comments": string}`. The agent reads the existing
 * tests in the working tree itself — we don't pass the test
 * contents into the prompt — and rewrites them to address the
 * comment. No production code, no commit (see the
 * `tdd-red-update-prompt-template.md` Iron Law).
 *
 * Pre-flight:
 *  - task exists on developer board, stage = "develop"
 *  - codeWorktreePath / openspecWorktreePath / parentTag /
 *    serviceName set
 *  - RED has actually exited 0 (otherwise the dev should
 *    use `/implement/restart` to retry, not the pencil)
 *  - no live RED UPDATE process (one update at a time per task)
 *  - `comments` is non-empty after `.trim()` and within
 *    [MIN_COMMENTS_LENGTH, MAX_COMMENTS_LENGTH]
 *
 * On success: 202 Accepted with the gigacode PID and log file.
 * The detail page re-fetches via `router.refresh()` and the
 * new "Обновление RED-фазы" process card appears below the
 * existing RED card. The TestDiffCard hides while the update
 * is alive (the diff would otherwise show in-progress edits).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const task = await findTaskByTagStrict("developer", params.tag);
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена в режиме "developer"` },
      { status: 404 },
    );
  }
  if (task.stage !== "develop") {
    return NextResponse.json(
      {
        error:
          "Обновление RED-тестов доступно только из стадии 'develop' в режиме разработчика",
      },
      { status: 409 },
    );
  }
  if (
    !task.codeWorktreePath ||
    !task.openspecWorktreePath ||
    !task.parentTag ||
    !task.serviceName
  ) {
    return NextResponse.json(
      {
        error:
          "У задачи нет привязки к worktree / parent / service — нельзя обновить RED",
      },
      { status: 400 },
    );
  }

  let body: { comments?: string } = {};
  try {
    body = (await req.json()) as { comments?: string };
  } catch {
    body = {};
  }
  const comments = (body.comments ?? "").trim();
  if (comments.length < MIN_COMMENTS_LENGTH) {
    return NextResponse.json(
      {
        error: `Комментарий должен быть не короче ${MIN_COMMENTS_LENGTH} символов — иначе непонятно, что переделывать`,
      },
      { status: 400 },
    );
  }
  if (comments.length > MAX_COMMENTS_LENGTH) {
    return NextResponse.json(
      {
        error: `Комментарий не должен превышать ${MAX_COMMENTS_LENGTH} символов`,
      },
      { status: 400 },
    );
  }

  // Refuse if RED itself hasn't succeeded yet — the pencil
  // is for fine-tuning existing tests, not for retrying a
  // failed first attempt (that's `/implement/restart`).
  if (task.redPhaseExitCode !== 0) {
    return NextResponse.json(
      {
        error:
          "RED-фаза ещё не завершилась успешно — перезапустите RED без комментариев через кнопку «Перезапустить»",
      },
      { status: 409 },
    );
  }

  // Don't allow parallel updates. The dev has to wait for the
  // current one to finish (or fail) before asking again.
  if (task.redPhaseUpdatePid && isProcessAlive(task.redPhaseUpdatePid)) {
    return NextResponse.json(
      {
        error:
          "Предыдущее обновление RED-тестов ещё выполняется — дождитесь завершения",
      },
      { status: 409 },
    );
  }

  const result = await runRedUpdateTdd(task, params.tag, comments);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(
    { ok: true, pid: result.pid, logFile: result.logFile },
    { status: 202 },
  );
}
