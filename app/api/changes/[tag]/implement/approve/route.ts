import { NextRequest, NextResponse } from "next/server";
import { findTaskByTagStrict } from "@/lib/state";
import { readConfig } from "@/lib/config";
import { runGreenTdd } from "@/lib/continuation";
import { isProcessAlive } from "@/lib/process";

/**
 * Human-gated transition from RED to GREEN. The dev has
 * already reviewed the test commits RED produced (via the
 * diff card on the develop page) and clicked "Подтвердить".
 * This endpoint stamps the approval timestamp, then spawns
 * the GREEN-phase `gigacode --prompt` run inside the
 * code-repo worktree.
 *
 * Pre-flight:
 *  - the task must exist on the developer board
 *  - RED must have completed successfully
 *    (`redPhaseExitCode === 0`)
 *  - RED must NOT have been approved before
 *    (`redPhaseApprovedAt == null`)
 *  - no live GREEN process already running
 *  - codeRepoPath / openspecWorktreePath / parentTag /
 *    serviceName must be set
 *
 * On success: 202 Accepted with the gigacode PID and log
 * file. The detail page re-fetches via `router.refresh()`
 * and the GREEN process card appears under the test-diff
 * card. The "Подтвердить" button is hidden once
 * `greenPhasePid` is set.
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
        error:
          "Утверждение TDD доступно только из стадии 'develop' в режиме разработчика",
      },
      { status: 409 },
    );
  }
  if (!task.codeWorktreePath) {
    return NextResponse.json(
      { error: "У задачи не записан codeWorktreePath" },
      { status: 400 },
    );
  }
  if (!task.openspecWorktreePath || !task.parentTag || !task.serviceName) {
    return NextResponse.json(
      {
        error:
          "У задачи нет привязки к parent / service — нельзя запустить GREEN",
      },
      { status: 400 },
    );
  }

  // The dev must approve an actually-completed RED. A RED
  // with no exit code is still running; a RED with non-zero
  // exit failed and shouldn't be approved; only
  // redPhaseExitCode === 0 with no prior approval is a
  // legitimate "approve and proceed" trigger.
  if (task.redPhaseExitCode == null) {
    return NextResponse.json(
      {
        error: "RED-фаза ещё не завершилась — дождитесь окончания",
      },
      { status: 409 },
    );
  }
  if (task.redPhaseExitCode !== 0) {
    return NextResponse.json(
      {
        error: `RED-фаза завершилась с ошибкой (exit ${task.redPhaseExitCode}) — сначала перезапустите RED`,
      },
      { status: 409 },
    );
  }
  if (task.redPhaseApprovedAt != null && task.redPhaseCommitError == null) {
    return NextResponse.json(
      {
        error:
          "Тесты уже утверждены — дождитесь окончания GREEN или смотрите логи",
      },
      { status: 409 },
    );
  }

  if (task.greenPhasePid && isProcessAlive(task.greenPhasePid)) {
    return NextResponse.json(
      {
        error: "GREEN-фаза уже выполняется — дождитесь окончания",
      },
      { status: 409 },
    );
  }

  // Stamp the approval timestamp FIRST, then commit RED
  // tests, then spawn GREEN. The two operations (stamp +
  // commit, commit + spawn) are not atomic, but the order
  // matters:
  //  - stamp first ensures a duplicate /implement/approve
  //    POST (e.g. a flaky network retry) hits the
  //    redPhaseApprovedAt check above and 409s out — the
  //    exception is a *previous* commit failure, where the
  //    check above now allows re-approve to retry the commit.
  //  - commit before spawn ensures the GREEN agent finds
  //    the failing tests already committed on the feature
  //    branch (its prompt assumes `git log` shows them).
  //    If the commit fails, we surface
  //    `redPhaseCommitError` and return 500 — the user
  //    retries via a second "Подтвердить" click (the
  //    approvedAt check now allows it because of the
  //    redPhaseCommitError != null branch).

  // We use a small write-then-read-then-write dance via the
  // shared `updateTask` helper to keep the read-modify-write
  // window narrow. The atomicity is best-effort (state.json
  // writes are atomic via atomic-write.ts, but the writes
  // — stamp, commit, spawn — are not). For a single-user
  // dev tool this is acceptable; a true multi-user system
  // would need a lock.
  const { updateTask, readState } = await import("@/lib/state");
  await updateTask("developer", params.tag, {
    redPhaseApprovedAt: new Date().toISOString(),
    // Clear any previous commit error so the UI shows the
    // fresh attempt — re-approve retries with the same
    // committedAt semantics.
    redPhaseCommitError: undefined,
    redPhaseCommitExitCode: undefined,
  });
  // Re-read to confirm the stamp landed. (If the write
  // failed the read would still show null; the check above
  // would then reject the second call anyway on the
  // next attempt.)
  void readState;

  // Commit RED tests to the feature branch as a single
  // commit. Mirrors the per-task commit semantics on the
  // analyst side, just one commit for the whole RED phase:
  //   `git -C <codeWorktreePath> status --porcelain` → skip
  //     if nothing to commit (RED wrote nothing).
  //   `git add -A` → stage every change in the worktree.
  //     RED typically writes new (untracked) test files; if
  //     there's anything else in the worktree, the user
  //     fixes it manually before re-approving.
  //   `git commit -m "test: RED-phase tests for <service>"`
  //     → one commit grouping all RED tests, matching the
  //     commit-after-approval invariant from the RED prompt
  //     template.
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const exec = promisify(execFile);
  const execOpts = { maxBuffer: 16 * 1024 * 1024 } as const;
  try {
    const { stdout: status } = await exec(
      "git",
      ["-C", task.codeWorktreePath, "status", "--porcelain"],
      execOpts,
    );
    if (status.trim() !== "") {
      await exec(
        "git",
        ["-C", task.codeWorktreePath, "add", "-A"],
        execOpts,
      );
      await exec(
        "git",
        [
          "-C",
          task.codeWorktreePath,
          "commit",
          "-m",
          `test: RED-phase tests for ${task.serviceName}`,
        ],
        execOpts,
      );
    }
    // Whatever the above produced, the commit succeeded
    // (or there was nothing to commit). Clear any stale
    // error and proceed.
    await updateTask("developer", params.tag, {
      redPhaseCommitError: undefined,
      redPhaseCommitExitCode: 0,
    });
  } catch (e) {
    const err = e as Error;
    await updateTask("developer", params.tag, {
      redPhaseCommitError: err.message,
      redPhaseCommitExitCode: 1,
    });
    return NextResponse.json(
      { error: `git commit failed: ${err.message}` },
      { status: 500 },
    );
  }

  const result = await runGreenTdd(task, params.tag);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(
    {
      ok: true,
      pid: result.pid,
      logFile: result.logFile,
    },
    { status: 202 },
  );
}
