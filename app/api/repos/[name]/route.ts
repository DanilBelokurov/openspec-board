import { NextRequest, NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/config";
import { removeSubmodule } from "@/lib/git-submodule";

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

  // Tear down the git submodule. The MCP tool writes its index
  // to `<repoRoot>/.code-review-graph/`, which lives INSIDE the
  // submodule directory — so removing the submodule also drops
  // the graph without a separate cleanup step.
  const repo = repos[name];
  const submoduleResult = await removeSubmodule(name, {
    buildPid: repo.buildPid,
    wikiPid: repo.wikiPid,
  });

  // Drop the entry from config.json last — only after the on-disk
  // cleanup has had its chance. If writeConfig fails, the entry
  // stays so the user can retry, but the cleanup above is still
  // a valid intermediate state.
  const next = { ...repos };
  delete next[name];
  const updated = await writeConfig({ repos: next });

  return NextResponse.json(
    {
      ok: submoduleResult.workTreeRemoved,
      repos: updated.repos,
      submodule: submoduleResult,
    },
    { status: submoduleResult.workTreeRemoved ? 200 : 500 },
  );
}
