import { NextRequest, NextResponse } from "next/server";
import { findTaskByTagStrict } from "@/lib/state";
import { readConfig } from "@/lib/config";

/**
 * Returns the diff of what RED wrote for the user to review.
 * Since commit 27e8f6f, RED no longer commits — it just writes
 * tests to the working tree and exits. The diff is therefore
 * against the *working tree*, not against HEAD. The endpoint
 * stays purely read-only:
 *
 *   git diff <redPhaseBaseSha>      (tracked changes:
 *                                    modifications + deletions)
 *   git ls-files --others --exclude-standard
 *                                  (list untracked files)
 *   for each untracked file:
 *     git diff --no-index /dev/null <file>
 *                                  (per-file diff, no lock)
 *
 * All three commands are read-only — neither `git diff` nor
 * `git ls-files` nor `git diff --no-index` touches the index,
 * so no `.git/index.lock` is created. Earlier this endpoint
 * called `git add -N .` to mark untracked files as
 * intent-to-add so the regular `git diff` would pick them up,
 * but that command modifies the index and acquires the lock.
 * A SIGKILL'd Node process (OOM, server restart, cancelled
 * fetch) was leaving the lock file behind, blocking every
 * subsequent diff call with
 * "Не удалось создать index.lock: Файл существует". The
 * read-only three-step version avoids the class entirely.
 *
 * `git diff --no-index` exits with code 1 when the files
 * differ (the normal case for a new untracked file). The
 * `exec` promise rejects, but the diff is in `e.stdout` —
 * see the catch in `getUntrackedFileDiff` below.
 *
 * After the user clicks "Подтвердить" the /implement/approve
 * endpoint commits the tests, so the working tree matches HEAD
 * again — the diff at that point is empty. We still use the
 * same command (working tree vs base SHA) so a re-approve after
 * a commit failure shows the same content the user approved
 * the first time.
 *
 * Empty `redPhaseBaseSha` (fresh worktree, no commits yet
 * before RED started) → 409; the diff card hides itself when
 * this field is null.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const config = await readConfig();
  void config;
  const task = await findTaskByTagStrict("developer", params.tag);
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена в режиме "developer"` },
      { status: 404 },
    );
  }
  if (!task.codeWorktreePath) {
    return NextResponse.json(
      { error: "У задачи не записан codeWorktreePath" },
      { status: 400 },
    );
  }
  if (task.redPhaseBaseSha == null) {
    return NextResponse.json(
      { error: "RED-фаза ещё не запускалась" },
      { status: 409 },
    );
  }

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const exec = promisify(execFile);
  const execOpts = { maxBuffer: 16 * 1024 * 1024 } as const;
  // Pull out the worktree path so the type narrowing holds
  // inside the helper call below — `task.codeWorktreePath`
  // is `string | undefined` on the row type, even though
  // we've already returned 400 above if it was missing.
  const worktreePath = task.codeWorktreePath as string;

  try {
    // 1. Tracked changes — modifications + deletions vs base SHA.
    const { stdout: trackedDiff } = await exec(
      "git",
      ["-C", worktreePath, "diff", task.redPhaseBaseSha],
      execOpts,
    );

    // 2. Untracked files. `git ls-files --others --exclude-standard`
    //    lists files that are not in the index and not ignored
    //    by .gitignore. One path per line, relative to the
    //    worktree root (set by `git -C`).
    const { stdout: untrackedList } = await exec(
      "git",
      [
        "-C",
        worktreePath,
        "ls-files",
        "--others",
        "--exclude-standard",
      ],
      execOpts,
    );
    const untrackedFiles = untrackedList
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    // 3. Per-file diff for untracked files. Read-only and
    //    lock-free — see the docstring above for why.
    const untrackedDiffs = await Promise.all(
      untrackedFiles.map((file) =>
        getUntrackedFileDiff(worktreePath, file, exec),
      ),
    );

    return new NextResponse(trackedDiff + untrackedDiffs.join(""), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `git diff failed: ${(e as Error).message}`,
      },
      { status: 500 },
    );
  }
}

/**
 * Diff a single untracked file against the empty tree. Uses
 * `git diff --no-index` — read-only, never creates
 * `.git/index.lock`.
 *
 * `git diff --no-index` exits with code 1 when the files
 * differ (the normal case for a new file). `promisify`d
 * `execFile` rejects on non-zero exit, so we catch and pull
 * the diff out of `e.stdout`. If the file disappeared between
 * `ls-files` and `diff --no-index` (or some other real error
 * happened), `e.stdout` is empty and we return an empty
 * string — the endpoint still returns the rest of the diff.
 */
async function getUntrackedFileDiff(
  worktreePath: string,
  file: string,
  exec: (cmd: string, args: string[], opts: { maxBuffer: number }) => Promise<{
    stdout: string;
    stderr: string;
  }>,
): Promise<string> {
  try {
    const { stdout } = await exec(
      "git",
      ["-C", worktreePath, "diff", "--no-index", "--no-color", "/dev/null", file],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout;
  } catch (e) {
    const err = e as { stdout?: string; code?: number | string };
    // Exit 1: files differ, diff is in stdout. Any other
    // code: real error (file vanished, permission denied,
    // …). Skip silently — the user still sees the rest of
    // the diff.
    if (err.code === 1 && typeof err.stdout === "string") {
      return err.stdout;
    }
    return "";
  }
}
