import { NextRequest, NextResponse } from "next/server";
import { findTaskByTagStrict } from "@/lib/state";
import { readConfig } from "@/lib/config";

/**
 * Returns the cumulative diff of the test commits RED made
 * on the feature branch, for the inline diff card on the
 * develop page. Runs
 *   `git -C <codeWorktreePath> diff <redPhaseBaseSha>..HEAD`
 * and returns the raw text (utf-8). The TestDiffCard
 * component passes it straight to react-diff-viewer-continued
 * which handles the side-by-side rendering, syntax
 * highlighting, and file collapsing.
 *
 * Empty `redPhaseBaseSha` (fresh worktree, no commits yet
 * before RED started) → we fall back to `git diff --root
 * HEAD` so an empty-tree diff is shown.
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

  try {
    // `git diff <base>..HEAD` — cumulative diff of every
    // commit RED made. We use the simpler two-dot form
    // (not the symmetric three-dot `...`) so RED's own
    // boundary commits are part of the comparison.
    const { stdout } = await exec(
      "git",
      [
        "-C",
        task.codeWorktreePath,
        "diff",
        `${task.redPhaseBaseSha}..HEAD`,
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
