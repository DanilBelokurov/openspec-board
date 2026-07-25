import { NextRequest, NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/config";
import { removeSubmodule } from "@/lib/git-submodule";
import { removeRepoData } from "@/lib/code-review-graph";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { name: string } },
) {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Сначала укажите директорию OpenSpec store в настройках" },
      { status: 400 },
    );
  }
  const name = params.name;
  const repos = config.repos ?? {};
  if (!repos[name]) {
    return NextResponse.json(
      { error: `Репозиторий "${name}" не найден в настройках` },
      { status: 404 },
    );
  }

  // Tear down the on-disk footprint. Both helpers are best-effort
  // and return a typed result so the caller can surface partial
  // failures. Order matters: submodule footgun first (it kills
  // in-flight build/visualize PIDs), then the graph index.
  const repo = repos[name];
  const submoduleResult = await removeSubmodule(name, {
    buildPid: repo.buildPid,
    visualizePid: repo.visualizePid,
  });
  const graphResult = await removeRepoData(name);

  // Drop the entry from config.json last — only after the on-disk
  // cleanup has had its chance. If writeConfig fails, the entry
  // stays so the user can retry, but the cleanup above is still
  // a valid intermediate state.
  const next = { ...repos };
  delete next[name];
  const updated = await writeConfig({ repos: next });

  // Surface a 500 only if BOTH cleanups failed — otherwise the
  // partial failure is enough to not pretend "ok" but the user
  // can still see which dir is left over via the result body.
  const cleanupFailed =
    !submoduleResult.dirRemoved || !graphResult.dirRemoved;
  return NextResponse.json(
    {
      ok: !cleanupFailed,
      repos: updated.repos,
      submodule: submoduleResult,
      graph: graphResult,
    },
    { status: cleanupFailed ? 500 : 200 },
  );
}
