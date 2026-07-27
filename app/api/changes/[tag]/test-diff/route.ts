import { NextRequest, NextResponse } from "next/server";
import { findTaskByTagStrict } from "@/lib/state";
import { readConfig } from "@/lib/config";

/**
 * Returns the diff of what RED wrote for the user to review.
 * Since commit 27e8f6f, RED no longer commits — it just writes
 * tests to the working tree and exits. The diff is therefore
 * against the *working tree*, not against HEAD: we run
 *
 *   git add -N .     (mark untracked files as intent-to-add
 *                     so they show up in `git diff`)
 *   git diff <redPhaseBaseSha>     (working tree vs base SHA)
 *
 * and return the raw text (utf-8). The TestDiffCard component
 * passes it straight to react-diff-viewer-continued which
 * handles the side-by-side rendering, syntax highlighting,
 * and file collapsing.
 *
 * After the user clicks "Подтвердить" the /implement/approve
 * endpoint commits the tests, so the working tree matches HEAD
 * again — the diff at that point is empty. We still use the
 * same command (working tree vs base SHA) so a re-approve after
 * a commit failure shows the same content the user approved
 * the first time.
 *
 * Empty `redPhaseBaseSha` (fresh worktree, no commits yet
 * before RED started) → we fall back to `git diff --root`,
 * which diffs against the empty tree.
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
    // RED never started — not an error state, but we have
    // nothing to diff. 409 parallels the old behaviour; the
    // diff card hides itself when this field is null.
    return NextResponse.json(
      { error: "RED-фаза ещё не запускалась" },
      { status: 409 },
    );
  }

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const exec = promisify(execFile);

  try {
    // Mark untracked files as intent-to-add so they appear in
    // the diff. `git add -N` is a no-op for files that are
    // already tracked (and harmless if there are no untracked
    // files at all). The intent-to-add marker is preserved in
    // the index until the user's "Подтвердить" eventually
    // runs `git add -A && git commit` in /implement/approve.
    await exec(
      "git",
      ["-C", task.codeWorktreePath, "add", "-N", "."],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const { stdout } = await exec(
      "git",
      [
        "-C",
        task.codeWorktreePath,
        "diff",
        task.redPhaseBaseSha,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return new NextResponse(stdout, {
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
