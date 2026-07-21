import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { readConfig } from "@/lib/config";
import { readState, updateTask } from "@/lib/state";
import {
  createWorktree,
  extractJiraId,
  removeWorktree,
  repoBasename,
} from "@/lib/git";
import {
  ensureLogDir,
  processLogPath,
  spawnGigacodeWithLog,
} from "@/lib/process-logger";

export async function POST(
  req: NextRequest,
  { params }: { params: { name: string } },
) {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Сначала укажите директорию OpenSpec store в настройках" },
      { status: 400 },
    );
  }

  const state = await readState();
  const task = state.tasks[params.name];
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.name}" не найдена` },
      { status: 404 },
    );
  }

  if (task.stage !== "backlog") {
    return NextResponse.json(
      { error: `Задача уже в статусе "${task.stage}", повторный запуск невозможен` },
      { status: 409 },
    );
  }

  let body: { jiraUrl?: string; codeRepoPath?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }

  const jiraUrl = (body.jiraUrl ?? "").trim();
  const codeRepoPath = (body.codeRepoPath ?? "").trim();

  if (!jiraUrl) {
    return NextResponse.json(
      { error: "Укажите ссылку на Jira-тикет" },
      { status: 400 },
    );
  }
  if (!codeRepoPath) {
    return NextResponse.json(
      { error: "Укажите путь к репозиторию с кодом" },
      { status: 400 },
    );
  }

  const jiraId = extractJiraId(jiraUrl);
  if (!jiraId) {
    return NextResponse.json(
      { error: `Не удалось извлечь Jira ticket id из "${jiraUrl}"` },
      { status: 400 },
    );
  }

  const openspecBasename = repoBasename(config.openspecDir);
  const openspecParent = path.dirname(config.openspecDir);
  const openspecWorktree = path.join(
    openspecParent,
    `${openspecBasename}.worktrees`,
    jiraId,
  );

  const codeBasename = repoBasename(codeRepoPath);
  const codeParent = path.dirname(codeRepoPath);
  const codeWorktree = path.join(
    codeParent,
    `${codeBasename}.worktrees`,
    jiraId,
  );

  // Create openspec worktree
  try {
    await createWorktree(config.openspecDir, openspecWorktree, jiraId);
  } catch (e) {
    return NextResponse.json(
      { error: `Openspec worktree: ${String(e)}` },
      { status: 500 },
    );
  }

  // Create code worktree (rollback openspec if this fails)
  try {
    await createWorktree(codeRepoPath, codeWorktree, jiraId);
  } catch (e) {
    try {
      await removeWorktree(config.openspecDir, openspecWorktree);
    } catch (cleanupErr) {
      console.error("Cleanup of openspec worktree failed:", cleanupErr);
    }
    return NextResponse.json(
      {
        error: `Code worktree: ${String(e)}. Openspec worktree откачен.`,
      },
      { status: 500 },
    );
  }

  // Update state
  // The worktree mirrors openspecDir's contents, so the change folder lives at
  // `<worktree>/changes/<name>/`, NOT `<worktree>/openspec/changes/<name>/`.
  const changePathInWorktree = path.join(
    openspecWorktree,
    "changes",
    params.name,
  );

  const updated = await updateTask(params.name, {
    stage: "decomposition",
    jiraUrl,
    codeRepoPath,
    openspecWorktreePath: openspecWorktree,
    codeWorktreePath: codeWorktree,
    startedAt: new Date().toISOString(),
    gigacodePid: null,
  });

  // Spawn gigacode detached
  const logFile = processLogPath(params.name, "new");
  await ensureLogDir();
  const gigacodePid = spawnPlanGigacode(
    changePathInWorktree,
    logFile,
    config.openspecDir,
  );
  if (updated && gigacodePid != null) {
    await updateTask(params.name, { gigacodePid, gigacodeLogPath: logFile });
  }

  return NextResponse.json({
    started: true,
    jiraId,
    jiraUrl,
    codeRepoPath,
    openspecWorktree,
    codeWorktree,
    changePath: changePathInWorktree,
    gigacodePid,
    stage: "decomposition",
  });
}

function spawnPlanGigacode(
  changePath: string,
  logFile: string,
  openspecDir: string,
): number | null {
  try {
    const result = spawnGigacodeWithLog({
      argv: ["-p", `/opsx:plan ${changePath}`],
      logFile,
      header: `gigacode /opsx:plan for ${changePath}`,
      addDir: openspecDir,
      approvalMode: "auto-edit",
    });
    result.promise
      .then(async ({ exitCode, signal }) => {
        // The /opsx:plan step doesn't get a per-task state record (it's
        // already in /opsx:plan pid slot only). We log the exit for diagnostics
        // but don't surface it in state — a separate refactor can add it.
        console.log(
          `gigacode /opsx:plan for ${changePath} exited (code=${exitCode}, signal=${signal})`,
        );
      })
      .catch((e) =>
        console.error(`gigacode /opsx:plan exit handler error:`, e),
      );
    return result.pid || null;
  } catch (e) {
    console.error(`gigacode /opsx:plan spawn threw for ${changePath}:`, e);
    return null;
  }
}