import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { findTaskByTagStrict, updateTask } from "@/lib/state";
import { isGitRepo } from "@/lib/git";
import {
  updateStageInOpenspecYaml,
  readStageFromOpenspecYaml,
} from "@/lib/openspec";
import { execFile } from "child_process";

/**
 * Run a git command inside a repo, rejecting with the combined
 * stderr on failure. Kept local to this route: the push/commit
 * sequence is publish-specific.
 */
function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${stderr || err.message}`.trim()));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * POST /api/changes/<tag>/publish-stage — «Опубликовать» on any
 * analyst stage (proposal / delta-spec / design / adr / done).
 *
 * Two things happen, in order:
 *
 *   1. The current stage is written into the change's
 *      `.openspec.yaml` (`stage: <stage>`) and committed. This file
 *      is the ground truth the remote scan later reads — other users
 *      see the real stage instead of the board guessing it from
 *      artifact presence.
 *   2. The branch is pushed to origin. Artifacts themselves are
 *      already committed by the per-stage confirm flow; this push
 *      carries them (plus the metadata commit) upstream.
 *
 * Safety: never force-pushes. If origin has commits the local
 * branch doesn't (another machine of the same author, or a
 * force-push race), the push fails non-fast-forward and the route
 * returns 409 with a clear message — the user resolves manually.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { tag: string } },
) {
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

  const task = await findTaskByTagStrict("analyst", params.tag);
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена в режиме "analyst"` },
      { status: 404 },
    );
  }
  if (task.remote === true) {
    return NextResponse.json(
      { error: "Задача опубликована другим пользователем — публикация недоступна" },
      { status: 403 },
    );
  }
  if (!task.openspecWorktreePath) {
    return NextResponse.json(
      { error: "У задачи не записан openspecWorktreePath" },
      { status: 400 },
    );
  }

  const worktree = task.openspecWorktreePath;
  const changeName = task.parentTag ?? task.summary.changeName;
  const stage = task.stage;

  // Which branch is the worktree on? A detached mirror would have no
  // named branch — refuse instead of pushing a detached state.
  let branch: string;
  try {
    branch = (await git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]))
      .stdout.trim();
  } catch (e) {
    return NextResponse.json(
      { error: `Не удалось определить ветку ворктрея: ${String(e)}` },
      { status: 500 },
    );
  }
  if (!branch || branch === "HEAD") {
    return NextResponse.json(
      {
        error:
          "Ворктрей в detached-состоянии — публикация возможна только на именованной ветке. Возьмите задачу в работу.",
      },
      { status: 409 },
    );
  }

  // 1. Stage → .openspec.yaml (+ commit when the file changed).
  let yamlCommitted = false;
  try {
    const changed = await updateStageInOpenspecYaml(worktree, changeName, stage);
    if (changed) {
      const yamlRel = `openspec/changes/${changeName}/.openspec.yaml`;
      await git(worktree, ["add", "--", yamlRel]);
      await git(worktree, [
        "commit",
        "-m",
        `chore(${changeName}): publish stage ${stage}`,
        "--",
        yamlRel,
      ]);
      yamlCommitted = true;
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Не удалось записать stage в .openspec.yaml: ${String(e)}` },
      { status: 500 },
    );
  }

  // 2. Push the branch (artifacts were committed by confirm; this
  // carries everything including the metadata commit).
  let pushOutput: string;
  try {
    const res = await git(worktree, ["push", "origin", `${branch}:${branch}`]);
    pushOutput = res.stdout || res.stderr;
  } catch (e) {
    const msg = String((e as Error).message);
    if (/non-fast-forward|rejected|fetch first/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "Ветка на remote опережает локальную (была изменена с другого места). Выполните git pull в ворктрее и повторите публикацию — force-push не выполняется автоматически.",
          detail: msg,
        },
        { status: 409 },
      );
    }
    // Roll back the metadata commit? No — it's harmless locally and
    // the retry will skip it (stage already recorded). Surface the
    // push error as-is.
    return NextResponse.json(
      { error: `Не удалось выполнить git push: ${msg}` },
      { status: 502 },
    );
  }

  const publishedStage = await readStageFromOpenspecYaml(worktree, changeName);
  await updateTask("analyst", params.tag, {
    pushedAt: new Date().toISOString(),
  });

  return NextResponse.json({
    published: true,
    stage,
    branch,
    yamlCommitted,
    yamlStage: publishedStage,
    pushOutput: pushOutput.slice(0, 2000),
  });
}
