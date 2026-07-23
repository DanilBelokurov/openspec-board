import { execFile } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { readState, updateTask } from "@/lib/state";
import { readConfig } from "@/lib/config";
import { isGitRepo } from "@/lib/git";
import { spawnGitPush } from "@/lib/git-push";

function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { maxBuffer: 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `git ${args.join(" ")} failed: ${err.message}\n${stderr}`,
            ),
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
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
  if (task.stage !== "done") {
    return NextResponse.json(
      {
        error:
          "Опубликовать ветку можно только из стадии «Готово» — текущая стадия: " +
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
  if (task.pushedAt) {
    // Idempotent: the 'Опубликовать ветку' button is one-shot in the
    // UI; the server stays idempotent in case the user replays the
    // request from devtools. Surface the existing push info.
    return NextResponse.json(
      {
        ok: true,
        alreadyPushed: true,
        pushedAt: task.pushedAt,
        pushRemoteUrl: task.pushRemoteUrl ?? null,
      },
    );
  }
  if (!task.openspecWorktreePath) {
    return NextResponse.json(
      { error: "У задачи не записан openspecWorktreePath" },
      { status: 400 },
    );
  }
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Сначала укажите директорию OpenSpec store в настройках" },
      { status: 400 },
    );
  }
  if (!(await isGitRepo(config.openspecDir))) {
    return NextResponse.json(
      {
        error: `Директория OpenSpec store не является git-репозиторием: ${config.openspecDir}`,
      },
      { status: 400 },
    );
  }

  // Read the current branch + remote URL from the worktree so we
  // can record them alongside the push state. Don't fail the push
  // if either of these reads blows up — the actual git push will
  // surface the real error.
  const branch = await runGit(task.openspecWorktreePath, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ])
    .then((r) => r.stdout.trim())
    .catch(() => "");

  let remoteUrl = "";
  if (branch) {
    try {
      remoteUrl = await runGit(task.openspecWorktreePath, [
        "config",
        "--get",
        `remote.origin.url`,
      ]).then((r) => r.stdout.trim());
    } catch {
      // no remote configured — leave remoteUrl empty
    }
  }

  const spawned = spawnGitPush(task.openspecWorktreePath, branch, params.tag);

  // Record the spawn result immediately. The watcher will flip
  // pushExitCode once the process is gone. If `uvx git push` (or
  // the local git binary) is missing, spawned.pid is null and we
  // record the error inline so the UI can surface it.
  if (spawned.pid == null) {
    await updateTask(params.tag, {
      pushPid: null,
      pushError: spawned.error ?? "Не удалось запустить git push",
      pushLogPath: spawned.logFile,
    });
    return NextResponse.json(
      { error: spawned.error ?? "Не удалось запустить git push" },
      { status: 500 },
    );
  }

  await updateTask(params.tag, {
    pushPid: spawned.pid,
    pushStartedAt: new Date().toISOString(),
    pushLogPath: spawned.logFile,
    pushRemoteUrl: remoteUrl || undefined,
    pushError: undefined,
  });

  return NextResponse.json(
    {
      ok: true,
      alreadyPushed: false,
      push: {
        pid: spawned.pid,
        logFile: spawned.logFile,
        remoteUrl: remoteUrl || null,
        branch,
      },
    },
    { status: 202 },
  );
}