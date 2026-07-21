import { NextRequest, NextResponse } from "next/server";
import "@/lib/watcher"; // side-effect: ensures background polling is running
import { readConfig } from "@/lib/config";
import { readState, updateTask, writeState } from "@/lib/state";
import { gigacodeStatusFor } from "@/lib/process";
import { slugify, uniqueSlug } from "@/lib/slug";
import {
  ensureLogDir,
  processLogPath,
  spawnGigacodeWithLog,
} from "@/lib/process-logger";

function nextTaskId(tasks: Record<string, unknown>): string {
  let max = 0;
  for (const key of Object.keys(tasks)) {
    const m = key.match(/^OS-(\d+)$/);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  // Also scan task.id fields (more reliable)
  // (already covered by map keys, but kept for clarity if keys change later)
  return `OS-${String(max + 1).padStart(3, "0")}`;
}

function makeEmptySummary(changeName: string, title: string, id: string) {
  return {
    id,
    changeName,
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

  let body: { title?: string; description?: string; tag?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  const description = (body.description ?? "").trim();
  // Tag is optional. If provided, must be ASCII (a-z, 0-9, '-') and short
  // — used as a short English label on the card and in detail page header.
  const rawTag = (body.tag ?? "").trim();
  if (rawTag && !/^[A-Za-z0-9-]{1,40}$/.test(rawTag)) {
    return NextResponse.json(
      {
        error:
          "tag должен быть 1-40 символов: только латиница, цифры и дефис (например add-oauth2)",
      },
      { status: 400 },
    );
  }
  const tag = rawTag || undefined;

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
  const base = slugify(title) || `proposal-${Date.now()}`;
  const taken = new Set(Object.keys(state.tasks));
  const changeName = uniqueSlug(base, taken);

  const id = nextTaskId(state.tasks);
  const now = new Date().toISOString();
  const summary = makeEmptySummary(changeName, title, id);

  const newTask = {
    id,
    stage: "proposal" as const,
    lastScannedAt: now,
    summary,
    description,
    tag,
    gigacodePid: null,
    gigacodeStartedAt: now,
  };

  const next = {
    tasks: { ...state.tasks, [changeName]: newTask },
  };
  await writeState(next);

  // Spawn gigacode headless. Per user spec:
  //   gigacode --approval-mode=auto-edit --add-dir <openspecDir> -p "/opsx-new <название задачи>"
  // The second step (--add-dir <openspecDir> -p "/opsx-continue ...") is triggered
  // later from /api/refresh / page loads / background watcher.
  const gigacodePrompt = `/opsx-new ${title}`;
  const logFile = processLogPath(changeName, "new");
  await ensureLogDir();

  const gigacodePid = await spawnProposalGigacode(
    changeName,
    gigacodePrompt,
    logFile,
    config.openspecDir,
  );

  if (gigacodePid != null) {
    next.tasks[changeName] = {
      ...newTask,
      gigacodePid,
      gigacodeLogPath: logFile,
    };
    await writeState(next);
  }

  return NextResponse.json(
    {
      created: true,
      task: next.tasks[changeName],
      gigacodePrompt,
      gigacodeStatus: gigacodeStatusFor(gigacodePid),
    },
    { status: 201 },
  );
}

async function spawnProposalGigacode(
  changeName: string,
  prompt: string,
  logFile: string,
  openspecDir: string,
): Promise<number | null> {
  try {
    const result = spawnGigacodeWithLog({
      argv: ["-p", prompt],
      logFile,
      header: `gigacode /opsx-new for ${changeName}`,
      addDir: openspecDir,
      approvalMode: "auto-edit",
    });
    // Fire-and-forget: when gigacode exits, write exit code/signal back to state
    result.promise
      .then(async ({ exitCode, signal }) => {
        await updateTask(changeName, {
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