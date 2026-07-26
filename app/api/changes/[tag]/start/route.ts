import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { updateTask, findTaskByTagStrict } from "@/lib/state";
import { createWorktree, pickFreeFeatureWorktree } from "@/lib/git";
import { extractJiraId } from "@/lib/jira";

export async function POST(
  req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Сначала укажите директорию OpenSpec store в настройках" },
      { status: 400 },
    );
  }

  // Mode-strict lookup: the /start endpoint is developer-mode
  // only. We read the current board mode from config and look
  // up the task in that mode — never in the other one. This
  // keeps the cross-mode data isolation that the developer-
  // mode worktree flow depends on: an analyst companion task
  // can never be picked up as the target of a developer-mode
  // action, even if a misconfigured client tried to call /start
  // from the analyst board.
  const task = await findTaskByTagStrict(config.mode, params.tag);
  if (!task) {
    return NextResponse.json(
      {
        error: `Задача "${params.tag}" не найдена в режиме "${config.mode}". Обновите доску.`,
      },
      { status: 404 },
    );
  }

  if (task.stage !== "backlog") {
    return NextResponse.json(
      { error: `Задача уже в статусе "${task.stage}", повторный запуск невозможен` },
      { status: 409 },
    );
  }

  // 1. Jira URL comes from the request body — the user types it
  //    into the StartForm field. The button is disabled until
  //    the field is non-empty, so by the time we get here the
  //    body is guaranteed to have jiraUrl. We do NOT parse
  //    proposal.md for Jira anymore: the form is the only
  //    source, by explicit product decision. If the field is
  //    empty (e.g. someone hand-rolled a POST), we 400.
  let body: { jiraUrl?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  const jiraUrl = (body.jiraUrl ?? "").trim();
  if (!jiraUrl) {
    return NextResponse.json(
      { error: "Введите ссылку на Jira-тикет" },
      { status: 400 },
    );
  }
  const jiraId = extractJiraId(jiraUrl);
  if (!jiraId) {
    return NextResponse.json(
      { error: `Не удалось извлечь Jira id из "${jiraUrl}"` },
      { status: 400 },
    );
  }

  // 2. Verify the change-proposal is on disk. We still need
  //    <openspecDir>/openspec/changes/<tag>/proposal.md (and
  //    later design.md / specs/) to exist for the plan pipeline
  //    and for downstream "Подтверждаю" to be meaningful. The
  //    presence check is read-only — we don't read its content
  //    for Jira, only confirm it's there.
  const proposalPath = path.join(
    config.openspecDir,
    "openspec",
    "changes",
    params.tag,
    "proposal.md",
  );
  try {
    await fs.access(proposalPath);
  } catch {
    return NextResponse.json(
      {
        error: `Не найден proposal.md для "${params.tag}" по пути ${proposalPath}`,
      },
      { status: 409 },
    );
  }

  // 3. Pick a free feature/<jiraId> worktree+branch pair.
  //    On collision, the helper suffixes the worktree path
  //    with -1, -2, ... (and the branch follows the path so
  //    the two names always match).
  const { branch, worktreePath } = await pickFreeFeatureWorktree(
    config.openspecDir,
    jiraId,
  );

  // 4. Create the worktree. If this throws, we leave the task
  //    in backlog and surface the error — no half-applied
  //    state.
  let worktree;
  try {
    worktree = await createWorktree(
      config.openspecDir,
      worktreePath,
      branch,
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Worktree: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  // 5. Update the developer task. jiraUrl is what the user
  //    typed (the same string the page badge will now show);
  //    jiraId is derived on demand via extractJiraId and not
  //    stored, in line with the principle that developer-mode
  //    data lives on the change-proposal, not in the task
  //    record.
  await updateTask("developer", params.tag, {
    stage: "plan",
    openspecWorktreePath: worktree.path,
    codeBranch: worktree.branch,
    jiraUrl,
    startedAt: new Date().toISOString(),
  });

  return NextResponse.json({
    started: true,
    stage: "plan",
    jiraId,
    jiraUrl,
    branch: worktree.branch,
    worktreePath: worktree.path,
    changePath: path.join(
      worktree.path,
      "openspec",
      "changes",
      params.tag,
    ),
  });
}
