import { NextRequest, NextResponse } from "next/server";
import "@/lib/watcher"; // side-effect: ensures background polling is running
import { readConfig } from "@/lib/config";
import { readState, updateTask, writeState } from "@/lib/state";
import { gigacodeStatusFor } from "@/lib/process";
import { extractJiraId } from "@/lib/jira";
import {
  ensureLogDir,
  processLogPath,
  spawnGigacodeWithLog,
} from "@/lib/process-logger";

const TAG_RE = /^[A-Za-z0-9-]{1,40}$/;

function nextTaskId(tasks: Record<string, unknown>): string {
  let max = 0;
  for (const key of Object.keys(tasks)) {
    const m = key.match(/^OS-(\d+)$/);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `OS-${String(max + 1).padStart(3, "0")}`;
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
  // and the identifier passed to gigacode. Because it lands in
  // <openspecDir>/changes/<tag>/ as a directory name, it must be a
  // filesystem-safe slug: ASCII letters/digits/dashes, 1-40 chars.
  const tag = (body.tag ?? "").trim();
  if (!tag) {
    return NextResponse.json(
      { error: "Укажите tag — короткое название латиницей (например add-oauth2-auth)" },
      { status: 400 },
    );
  }
  if (!TAG_RE.test(tag)) {
    return NextResponse.json(
      {
        error:
          "tag должен быть 1-40 символов: только латиница, цифры и дефис (например add-oauth2)",
      },
      { status: 400 },
    );
  }

  // jiraUrl is optional. If provided, must extract a ticket id.
  const rawJiraUrl = (body.jiraUrl ?? "").trim();
  let jiraUrl: string | undefined;
  if (rawJiraUrl) {
    const jiraId = extractJiraId(rawJiraUrl);
    if (!jiraId) {
      return NextResponse.json(
        { error: `Не удалось извлечь Jira ticket id из "${rawJiraUrl}"` },
        { status: 400 },
      );
    }
    jiraUrl = rawJiraUrl;
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

  const id = nextTaskId(state.tasks);
  const now = new Date().toISOString();
  const summary = makeEmptySummary(tag, title, id);

  const newTask = {
    id,
    stage: "proposal" as const,
    lastScannedAt: now,
    summary,
    description,
    jiraUrl,
    gigacodePid: null,
    gigacodeStartedAt: now,
  };

  const next = {
    tasks: { ...state.tasks, [tag]: newTask },
  };
  await writeState(next);

  // Spawn gigacode headless. The identifier passed to /opsx-new is exactly
  // the same string we used as folder name, state key, and log filename —
  // no second naming convention to drift.
  // The second step (/opsx-continue) is triggered later from /api/refresh /
  // page loads / background watcher.
  const gigacodePrompt = `/opsx-new ${tag}`;
  const logFile = processLogPath(tag, "new");
  await ensureLogDir();

  const gigacodePid = await spawnProposalGigacode(
    tag,
    gigacodePrompt,
    logFile,
    config.openspecDir,
  );

  if (gigacodePid != null) {
    next.tasks[tag] = {
      ...newTask,
      gigacodePid,
      gigacodeLogPath: logFile,
    };
    await writeState(next);
  }

  return NextResponse.json(
    {
      created: true,
      task: next.tasks[tag],
      gigacodePrompt,
      gigacodeStatus: gigacodeStatusFor(gigacodePid),
    },
    { status: 201 },
  );
}

async function spawnProposalGigacode(
  tag: string,
  prompt: string,
  logFile: string,
  openspecDir: string,
): Promise<number | null> {
  try {
    const result = spawnGigacodeWithLog({
      argv: ["--prompt", prompt],
      logFile,
      header: `gigacode /opsx-new for ${tag}`,
      addDir: openspecDir,
      approvalMode: "auto-edit",
    });
    // Fire-and-forget: when gigacode exits, write exit code/signal back to state
    result.promise
      .then(async ({ exitCode, signal }) => {
        await updateTask(tag, {
          gigacodeExitCode: exitCode,
          gigacodeExitSignal: signal,
        });
      })
      .catch((e) => console.error(`gigacode-new exit handler error:`, e));
    return result.pid || null;
  } catch (e) {
    console.error(`gigacode -p spawn threw:`, e);
    return null;
  }
}
