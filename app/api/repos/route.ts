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
    result = await addOrCheckoutSubmodule(
      config.openspecDir,
      name,
      url,
      branch,
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Не удалось установить submodule: ${String(e)}` },
      { status: 500 },
    );
  }

  // Persist into config.json so subsequent restarts see the repo.
  const nextRepos = { ...existing, [name]: { url, branch } };
  const updated = await writeConfig({ repos: nextRepos });

  return NextResponse.json(
    {
      created: true,
      repo: { name, url, branch },
      path: result.path,
      onDisk: result.created ? "created" : "reused",
      repos: updated.repos,
    },
    { status: 201 },
  );
}