import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { readState, findTaskByTag } from "@/lib/state";
import {
  readChange,
  readChangeFromGit,
  resolveArtifactSource,
} from "@/lib/openspec";

export async function GET(
  _req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "openspecDir not configured" },
      { status: 400 },
    );
  }
  try {
    // Both analyst and developer tasks target the same change folder
    // (`<openspecDir>/openspec/changes/<tag>/`). Prefer the mode
    // matching the current board. Remote tasks (published by another
    // user) have no local worktree, so their artifacts are read from
    // git at sourceCommit; everything else reads from the filesystem.
    const state = await readState();
    const found = await findTaskByTag(params.tag, config.mode);
    const task = found?.task;
    let change;
    if (task) {
      const source = await resolveArtifactSource(task, config.openspecDir);
      change =
        source.kind === "git"
          ? await readChangeFromGit(
              source.repoDir,
              source.ref,
              source.changeName,
            )
          : await readChange(source.root, params.tag);
    } else {
      change = await readChange(config.openspecDir, params.tag);
    }
    return NextResponse.json(change);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to read ${params.tag}: ${String(e)}` },
      { status: 500 },
    );
  }
}
