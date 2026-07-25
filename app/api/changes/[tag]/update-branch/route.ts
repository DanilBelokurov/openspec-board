import { execFile } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { readState, updateTask } from "@/lib/state";
import { readConfig } from "@/lib/config";
import { isGitRepo } from "@/lib/git";
import { spawnGitPushUpdate } from "@/lib/git-push";

/**
 * «Обновить ветку» — fast-forward the already-published feature
 * branch with any new commits that landed since the initial push.
 *
 * Distinct from POST /push (which sets up tracking with
 * `git push -u origin <branch>` for a never-published branch):
 * here tracking already exists, so we just run a plain
 * `git push origin <branch>`. The existing PR on GitHub/GitLab
 * picks up the new commits automatically.
 *
 * Reached when the analyst re-confirms at the done stage after a
 * reopen (design / adr re-writes produced new commits) and the
 * branch's tracking and PR are already in place. The DoneDeploymentActions
 * panel renders a single «Обновить ветку» button when both
 * `pushedAt` and `pullRequestExitCode === 0` are present.
 */

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
          "Обновить ветку можно только из стадии «Готово» — текущая стадия: " +
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
  // Gate: branch must already be published and a PR must already
  // exist for this branch. Without these preconditions, the right
  // action is «Опубликовать ветку» + «Сделать pull request» (the
  // initial-publish flow), not «Обновить ветку».
  if (!task.pushedAt) {
    return NextResponse.json(
      {
        error:
          "Сначала опубликуйте ветку — нажмите «Опубликовать ветку» и дождитесь её завершения",
      },
      { status: 409 },
    );
  }
  if (task.pullRequestExitCode !== 0) {
    return NextResponse.json(
      {
        error:
          "Сначала создайте pull request — кнопка «Сделать pull request» станет активной после успешной публикации ветки",
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

  // Read the current branch from the worktree so we can pass it
  // to `git push`. Don't fail the spawn if the read blows up —
  // the actual git push will surface the real error.
  const branch = await runGit(task.openspecWorktreePath, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ])
    .then((r) => r.stdout.trim())
    .catch(() => "");

  const spawned = spawnGitPushUpdate(
    task.openspecWorktreePath,
    branch,
    params.tag,
  );

  if (spawned.pid == null) {
    await updateTask(params.tag, {
      pushError: spawned.error ?? "Не удалось запустить git push",
      pushLogPath: spawned.logFile,
    });
    return NextResponse.json(
      { error: spawned.error ?? "Не удалось запустить git push" },
      { status: 500 },
    );
  }

  // Record the spawn. We deliberately do NOT touch pushedAt here —
  // the watcher writes a fresh pushedAt timestamp once the process
  // exits (so the «Опубликовано: …» indicator reflects the last
  // successful sync, not the original publish).
  await updateTask(params.tag, {
    pushPid: spawned.pid,
    pushStartedAt: new Date().toISOString(),
    pushLogPath: spawned.logFile,
    pushError: undefined,
  });

  return NextResponse.json(
    {
      ok: true,
      push: {
        pid: spawned.pid,
        logFile: spawned.logFile,
        branch,
      },
    },
    { status: 202 },
  );
}
