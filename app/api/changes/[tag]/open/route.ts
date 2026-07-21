import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";
import { readConfig } from "@/lib/config";
import { readState } from "@/lib/state";
import { resolveProposalRootForTask } from "@/lib/openspec";

function openInOS(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];

    if (process.platform === "darwin") {
      cmd = "open";
      args = [target];
    } else if (process.platform === "win32") {
      cmd = "cmd";
      args = ["/c", "start", "", target];
    } else {
      cmd = "xdg-open";
      args = [target];
    }

    execFile(cmd, args, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function POST(
  req: NextRequest,
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
  const task = state.tasks[params.tag];
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена` },
      { status: 404 },
    );
  }

  // Analyst-mode tasks live on a dedicated worktree; that is where the
  // change folder (proposal.md, specs/, etc.) is created. The helper
  // also probes the on-disk worktree convention when the task's
  // openspecWorktreePath field is missing, so legacy tasks still
  // resolve to the correct path. The standard OpenSpec layout puts
  // change folders under `<repo>/openspec/changes/<tag>/`, so we
  // join the additional "openspec/changes" segments here.
  const changeRoot = path.join(
    await resolveProposalRootForTask(task, config.openspecDir),
    "openspec",
    "changes",
    params.tag,
  );

  let body: { path?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body → open root */
  }

  const requested = (body.path ?? "").replace(/^\/+/, "");
  const target = path.resolve(changeRoot, requested);

  const rel = path.relative(changeRoot, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return NextResponse.json(
      { error: "Путь выходит за пределы change-proposal" },
      { status: 400 },
    );
  }

  try {
    await openInOS(target);
    return NextResponse.json({ opened: true, path: rel });
  } catch (e) {
    return NextResponse.json(
      { error: `Не удалось открыть: ${String(e)}` },
      { status: 500 },
    );
  }
}
