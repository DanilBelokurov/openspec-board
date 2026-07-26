import { execFile } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { readState, writeState, findTaskByTag, taskKey } from "@/lib/state";
import { readConfig } from "@/lib/config";
import { isGitRepo } from "@/lib/git";
import { cleanupTask } from "@/lib/git-cleanup";

function execGit(
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
        resolve({ stdout: String(stdout).trim(), stderr: String(stderr) });
      },
    );
  });
}

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
  const state = await readState();
  // Delete is mode-agnostic — it tears down the worktree for
  // whichever board the user is on. Prefer the current board's
  // task; fall back to the other mode if needed.
  const found = await findTaskByTag(params.tag, config.mode);
  const task = found?.task;
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена` },
      { status: 404 },
    );
  }
  if (!task.openspecWorktreePath) {
    return NextResponse.json(
      { error: "У задачи не записан openspecWorktreePath — нечего удалять" },
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

  // Read the branch name from the worktree itself (it's the same
  // branch `git worktree add -b feature/<jiraId> …` checked out
  // when the task was created).
  let branchName: string;
  try {
    branchName = (
      await execGit(task.openspecWorktreePath, [
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ])
    ).stdout;
  } catch (e) {
    return NextResponse.json(
      {
        error: `Не удалось определить имя ветки в worktree: ${(e as Error).message}`,
      },
      { status: 500 },
    );
  }

  const { actions } = await cleanupTask(
    config.openspecDir,
    task.openspecWorktreePath,
    branchName,
  );

  // Drop the entry from state. Use writeState so the board reflects
  // the change on the next refresh. Drop the entry we found; if a
  // sibling task exists in the other mode (same tag, opposite
  // board), leave it in place — they're independent records.
  const nextTasks = { ...state.tasks };
  if (found) {
    delete nextTasks[found.key];
  }
  await writeState({ tasks: nextTasks });

  return NextResponse.json({
    ok: true,
    tag: params.tag,
    branch: branchName,
    worktree: task.openspecWorktreePath,
    actions,
  });
}