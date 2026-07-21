import { NextRequest, NextResponse } from "next/server";
import "@/lib/watcher"; // side-effect: ensures background polling is running
import { readConfig } from "@/lib/config";
import { readState, updateTask, writeState } from "@/lib/state";
import { processStatusFor } from "@/lib/process";
import { extractJiraId } from "@/lib/jira";
import { isValidOpenspecTag } from "@/lib/tag";
import {
  ensureLogDir,
  processLogPath,
  spawnDetachedWithLog,
} from "@/lib/process-logger";
import { randomUUID } from "crypto";
import path from "path";
import { repoBasename } from "@/lib/path-utils";
import { createWorktreeFromBranch } from "@/lib/git-worktree";
import { isGitRepo } from "@/lib/git";

function nextTaskId(_tasks: Record<string, unknown>): string {
  return randomUUID();
}

function makeEmptySummary(tag: string, title: string, id: string) {
  return {
    id,
    changeName: tag,
    path: "",
    title,
    stage: "proposal" as const,
    hasProposal: false,
    hasDesign: false,
    hasSpecs: false,
    capabilityTags: [],
    specCounts: { added: 0, modified: 0, removed: 0, scenarios: 0 },
    newCapabilities: [],
    modifiedCapabilities: [],
    updatedAt: new Date().toISOString(),
    fileCount: 0,
    totalSize: 0,
  };
}

export async function GET() {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json([]);
  }
  try {
    const state = await readState();
    const tasks = Object.values(state.tasks);
    return NextResponse.json(tasks);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to read state: ${String(e)}` },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const config = await readConfig();
  if (config.mode !== "analyst") {
    return NextResponse.json(
      { error: "Создание proposal доступно только в режиме «Аналитик»" },
      { status: 400 },
    );
  }
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Укажите директорию OpenSpec store в настройках" },
      { status: 400 },
    );
  }

  let body: {
    title?: string;
    description?: string;
    tag?: string;
    jiraUrl?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  const description = (body.description ?? "").trim();
  // Tag is the canonical identifier for the change: it becomes the change
  // folder name, the state.json key, the URL segment, the log filename,
  // and the identifier passed to `openspec new change`. We validate
  // against that CLI's rules so the spawn can't fail with a name error.
  const tag = (body.tag ?? "").trim();
  if (!tag) {
    return NextResponse.json(
      { error: "Укажите tag — короткое название латиницей (например add-oauth2-auth)" },
      { status: 400 },
    );
  }
  if (!isValidOpenspecTag(tag)) {
    return NextResponse.json(
      {
        error:
          "tag должен быть в lowercase kebab-case (например add-oauth2): строчные латинские буквы, цифры и одиночные дефисы, начинается с буквы, без двойных дефисов, 1-40 символов",
      },
      { status: 400 },
    );
  }

  // jiraUrl is REQUIRED — it's used to derive the branch name
  // (feature/<JIRA-ID>) and the worktree path. The Jira ticket id must
  // be extractable from the URL.
  const rawJiraUrl = (body.jiraUrl ?? "").trim();
  if (!rawJiraUrl) {
    return NextResponse.json(
      { error: "Укажите ссылку на Jira-тикет — она используется для имени ветки и worktree" },
      { status: 400 },
    );
  }
  const jiraId = extractJiraId(rawJiraUrl);
  if (!jiraId) {
    return NextResponse.json(
      { error: `Не удалось извлечь Jira ticket id из "${rawJiraUrl}"` },
      { status: 400 },
    );
  }

  if (!title) {
    return NextResponse.json(
      { error: "Укажите название proposal" },
      { status: 400 },
    );
  }
  if (!description) {
    return NextResponse.json(
      { error: "Укажите описание proposal" },
      { status: 400 },
    );
  }

  const state = await readState();
  if (state.tasks[tag]) {
    return NextResponse.json(
      {
        error: `Change с тегом "${tag}" уже существует. Тег должен быть уникальным.`,
      },
      { status: 409 },
    );
  }

  // The sdd-store (config.openspecDir) MUST be a git repo for the
  // worktree flow. Refuse early with a clear error if not.
  if (!(await isGitRepo(config.openspecDir))) {
    return NextResponse.json(
      {
        error: `Директория OpenSpec store не является git-репозиторием: ${config.openspecDir}`,
      },
      { status: 400 },
    );
  }

  // Compute the worktree path: <openspecDirParent>/<openspecDirBasename>.worktrees/<jiraId>/
  const openspecBasename = repoBasename(config.openspecDir);
  const openspecParent = path.dirname(config.openspecDir);
  const openspecWorktree = path.join(
    openspecParent,
    `${openspecBasename}.worktrees`,
    jiraId,
  );
  const branch = `feature/${jiraId}`;

  // Update the configured main branch from origin and create the worktree
  // on the new feature branch. Failure here aborts the create — no state
  // has been written yet, so nothing to clean up.
  try {
    await createWorktreeFromBranch(
      config.openspecDir,
      openspecWorktree,
      branch,
      config.defaultBranch,
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Не удалось создать worktree: ${String(e)}` },
      { status: 500 },
    );
  }

  const id = nextTaskId(state.tasks);
  const now = new Date().toISOString();
  const summary = makeEmptySummary(tag, title, id);

  const newTask = {
    id,
    stage: "proposal" as const,
    lastScannedAt: now,
    summary,
    description,
    jiraUrl: rawJiraUrl,
    openspecWorktreePath: openspecWorktree,
    openspecNewPid: null,
    openspecNewStartedAt: now,
  };

  const next = {
    tasks: { ...state.tasks, [tag]: newTask },
  };
  await writeState(next);

  // Spawn `openspec new change` headless INSIDE the worktree (cwd=<worktree>).
  // This creates the change directory and .openspec.yaml metadata file.
  // The next step (openspec instructions proposal + gigacode /opsx-continue
  // with --prompt) is auto-triggered from lib/continuation.ts once the
  // watcher or page render sees .openspec.yaml on disk without
  // proposal.md yet.
  //
  // --description writes the body into README.md inside the change folder,
  // preserved as ground truth for the proposal-generation step.
  const logFile = processLogPath(tag, "new");
  await ensureLogDir();

  const openspecNewPid = await spawnProposalOpenspecNew(
    tag,
    description,
    logFile,
    openspecWorktree,
  );

  if (openspecNewPid != null) {
    next.tasks[tag] = {
      ...newTask,
      openspecNewPid,
      openspecNewLogPath: logFile,
    };
    await writeState(next);
  }

  return NextResponse.json(
    {
      created: true,
      task: next.tasks[tag],
      openspecCommand: `openspec new change ${tag} --description "${description.replace(/"/g, '\\"')}"`,
      openspecNewStatus: processStatusFor(openspecNewPid),
      worktreePath: openspecWorktree,
      branch,
    },
    { status: 201 },
  );
}

async function spawnProposalOpenspecNew(
  tag: string,
  description: string,
  logFile: string,
  cwd: string,
): Promise<number | null> {
  try {
    const result = spawnDetachedWithLog({
      command: "openspec",
      argv: ["new", "change", tag, "--description", description],
      logFile,
      header: `openspec new change for ${tag}`,
      cwd,
    });
    // Fire-and-forget: when openspec exits, write exit code/signal back to
    // state. The continuation auto-trigger watches for `.openspec.yaml`
    // appearing on disk — that's the readiness signal this step produces.
    result.promise
      .then(async ({ exitCode, signal }) => {
        await updateTask(tag, {
          openspecNewExitCode: exitCode,
          openspecNewExitSignal: signal,
        });
      })
      .catch((e) =>
        console.error(`openspec-new exit handler error:`, e),
      );
    return result.pid || null;
  } catch (e) {
    console.error(`openspec new change spawn threw:`, e);
    return null;
  }
}
