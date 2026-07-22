import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  deriveRepoNameFromUrl,
  isValidRepoBranch,
  isValidRepoName,
  isValidRepoUrl,
} from "@/lib/repo-name";
import { readConfig, writeConfig } from "@/lib/config";
import { isGitRepo } from "@/lib/git";
import { addOrCheckoutSubmodule } from "@/lib/git-submodule";
import { spawnCodeReviewGraphBuild } from "@/lib/code-review-graph";

export async function POST(req: NextRequest) {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Сначала укажите директорию OpenSpec store в настройках" },
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

  let body: { url?: string; branch?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    );
  }
  const url = (body.url ?? "").trim();
  const branch = (body.branch ?? "").trim();

  if (!url) {
    return NextResponse.json(
      { error: "Укажите URL репозитория" },
      { status: 400 },
    );
  }
  if (!isValidRepoUrl(url)) {
    return NextResponse.json(
      {
        error:
          "URL должен начинаться с https://, http://, ssh://, git:// или git@",
      },
      { status: 400 },
    );
  }

  // Derive the directory name from the URL — the user no longer
  // types it in. This keeps the two in sync and removes the
  // chance of typos that conflict with existing repos.
  const derivedName = deriveRepoNameFromUrl(url);
  if (!derivedName) {
    return NextResponse.json(
      { error: "Не удалось извлечь имя репозитория из URL" },
      { status: 400 },
    );
  }
  if (!isValidRepoName(derivedName)) {
    return NextResponse.json(
      {
        error: `Имя "${derivedName}" не подходит под kebab-case (строчные латинские буквы, цифры, одиночные дефисы, начинается с буквы)`,
      },
      { status: 400 },
    );
  }
  const name = derivedName;

  if (!branch) {
    return NextResponse.json(
      { error: "Укажите ветку для отслеживания" },
      { status: 400 },
    );
  }
  if (!isValidRepoBranch(branch)) {
    return NextResponse.json(
      {
        error:
          "Имя ветки содержит недопустимые символы (пусто, .., //, @{, контрольные символы)",
      },
      { status: 400 },
    );
  }

  const existing = config.repos ?? {};
  if (existing[name]) {
    return NextResponse.json(
      {
        error: `Репозиторий "${name}" уже добавлен`,
      },
      { status: 409 },
    );
  }

  // Add the submodule and check out the requested branch. Failure
  // here aborts the operation — we don't write to config if the
  // submodule didn't actually materialise.
  let result;
  try {
    result = await addOrCheckoutSubmodule(name, url, branch);
  } catch (e) {
    return NextResponse.json(
      { error: `Не удалось установить submodule: ${String(e)}` },
      { status: 500 },
    );
  }

  // Persist into config.json so subsequent restarts see the repo.
  // After the submodule is registered, kick off step 1 of the
  // code-review-graph pipeline (`build`). Step 2 (`visualize`)
  // is chained by lib/watcher.ts once the build exits 0 — that's
  // why the response only reports the build PID/log here.
  const spawned = await spawnCodeReviewGraphBuild(name);
  const buildLogPath = `.sdd-board/logs/repos/${name}.graph-build.log`;
  const visualizeLogPath = `.sdd-board/logs/repos/${name}.graph-visualize.log`;
  const repoEntry = {
    url,
    branch,
    buildPid: spawned.pid ?? null,
    buildStartedAt: spawned.pid != null ? new Date().toISOString() : undefined,
    buildLogPath,
    visualizeLogPath,
  };
  const nextRepos = { ...existing, [name]: repoEntry };
  const updated = await writeConfig({ repos: nextRepos });

  return NextResponse.json(
    {
      created: true,
      repo: { name, url, branch },
      path: result.path,
      onDisk: result.created ? "created" : "reused",
      build: {
        spawned: spawned.pid != null,
        pid: spawned.pid,
        logFile: path.join(config.openspecDir, buildLogPath),
      },
      repos: updated.repos,
    },
    { status: 201 },
  );
}