import { NextRequest, NextResponse } from "next/server";
import { findTaskByTagStrict } from "@/lib/state";
import { readConfig } from "@/lib/config";
import { convertRemoteUrlToHttps } from "@/lib/continuation";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

/**
 * Retry `git push -u origin <branch>` for the RED tests
 * commit. The first push is attempted from the RED exit
 * handler (via `commitAndPushRedTests`); this endpoint is
 * the user-driven retry path when the first push failed
 * (auth, network, non-fast-forward, no remote configured,
 * …).
 *
 * Pre-flight:
 *  - task exists on developer board, stage = "develop"
 *  - RED exit 0 (commit + push are post-RED exit-0 flows)
 *  - `redPhaseCommitSha` is set (i.e. the auto-commit
 *    succeeded). Without a commit there's nothing to push.
 *  - `redPhasePushError` is set (the only reason to retry;
 *    if push succeeded, the retry is a no-op).
 *
 * On success: 200 with the new `pushedAt` timestamp. The
 * detail page re-fetches and the ReviewReadyCard flips
 * "Подтвердить" from disabled to enabled.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const config = await readConfig();
  void config;
  const task = await findTaskByTagStrict("developer", params.tag);
  if (!task) {
    return NextResponse.json(
      {
        error: `Задача "${params.tag}" не найдена в режиме "developer"`,
      },
      { status: 404 },
    );
  }
  if (task.stage !== "develop") {
    return NextResponse.json(
      {
        error: "Push доступен только из стадии 'develop'",
      },
      { status: 409 },
    );
  }
  if (!task.codeWorktreePath || !task.codeBranch) {
    return NextResponse.json(
      {
        error: "У задачи не записан codeWorktreePath или codeBranch",
      },
      { status: 400 },
    );
  }
  if (task.redPhaseExitCode !== 0) {
    return NextResponse.json(
      {
        error: "RED-фаза не завершилась успешно — push недоступен",
      },
      { status: 409 },
    );
  }
  if (task.redPhaseCommitSha == null) {
    return NextResponse.json(
      {
        error:
          "Auto-коммит RED-тестов не выполнен — нечего пушить. Перезапустите RED.",
      },
      { status: 409 },
    );
  }

  // Don't fight a still-running push. `commitAndPushRedTests`
  // is fire-and-forget in the RED exit handler; in practice
  // push is fast and a user retry is only meaningful after
  // push has died. We don't track a push PID, so the only
  // way to tell is "is there a redPhasePushError"? If push
  // succeeded last time, this endpoint is a no-op (the push
  // command will be a fast-forward).
  if (!task.redPhasePushError) {
    // Treat as idempotent success — the user might be
    // double-clicking. Return 200 with the current state.
    return NextResponse.json(
      {
        ok: true,
        pushedAt: task.redPhasePushedAt,
        branch: task.redPhasePushBranch,
        remoteUrl: task.redPhasePushRemoteUrl,
      },
      { status: 200 },
    );
  }

  const execOpts = { maxBuffer: 16 * 1024 * 1024 } as const;
  try {
    await exec(
      "git",
      [
        "-C",
        task.codeWorktreePath,
        "push",
        "-u",
        "origin",
        task.codeBranch,
      ],
      execOpts,
    );
    const { stdout: remoteUrlRaw } = await exec(
      "git",
      ["-C", task.codeWorktreePath, "config", "--get", "remote.origin.url"],
      execOpts,
    );
    const { updateTask } = await import("@/lib/state");
    await updateTask(task.mode, params.tag, {
      redPhasePushedAt: new Date().toISOString(),
      redPhasePushBranch: task.codeBranch,
      redPhasePushRemoteUrl: convertRemoteUrlToHttps(remoteUrlRaw.trim()),
      redPhasePushError: undefined,
    });
    return NextResponse.json(
      {
        ok: true,
        branch: task.codeBranch,
        pushedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (e) {
    const err = e as Error;
    const { updateTask } = await import("@/lib/state");
    await updateTask(task.mode, params.tag, {
      redPhasePushError: err.message,
    });
    return NextResponse.json(
      { error: `git push failed: ${err.message}` },
      { status: 500 },
    );
  }
}
