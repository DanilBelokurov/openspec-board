import { NextRequest, NextResponse } from "next/server";
import "@/lib/watcher"; // side-effect: ensures background polling is running
import { readConfig } from "@/lib/config";
import { readState, updateTask, writeState } from "@/lib/state";
import { qwenStatusFor } from "@/lib/process";
import { slugify, uniqueSlug } from "@/lib/slug";
import {
  ensureLogDir,
  qwenLogPath,
  spawnQwenWithLog,
} from "@/lib/qwen-logger";

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

  let body: { title?: string; description?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  const description = (body.description ?? "").trim();

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
    qwenPid: null,
    qwenStartedAt: now,
  };

  const next = {
    tasks: { ...state.tasks, [changeName]: newTask },
  };
  await writeState(next);

  // Spawn qwen headless. Per user spec:
  //   qwen -p "/opsx-new <название задачи>"
  // The second step (qwen -p "/opsx-continue" after .openspec.yaml exists)
  // is triggered later from /api/refresh / page loads / background watcher.
  const qwenPrompt = `/opsx-new ${title}`;
  const logFile = qwenLogPath(changeName, "new");
  await ensureLogDir();

  const qwenPid = await spawnProposalQwen(changeName, qwenPrompt, logFile);

  if (qwenPid != null) {
    next.tasks[changeName] = { ...newTask, qwenPid, qwenLogPath: logFile };
    await writeState(next);
  }

  return NextResponse.json(
    {
      created: true,
      task: next.tasks[changeName],
      qwenPrompt,
      qwenStatus: qwenStatusFor(qwenPid),
    },
    { status: 201 },
  );
}

async function spawnProposalQwen(
  changeName: string,
  prompt: string,
  logFile: string,
): Promise<number | null> {
  try {
    const result = spawnQwenWithLog({
      argv: ["-p", prompt],
      logFile,
      header: `qwen /opsx-new for ${changeName}`,
    });
    // Fire-and-forget: when qwen exits, write exit code/signal back to state
    result.promise.then(async ({ exitCode, signal }) => {
      await updateTask(changeName, {
        qwenExitCode: exitCode,
        qwenExitSignal: signal,
      });
    }).catch((e) => console.error(`qwen-new exit handler error:`, e));
    return result.pid || null;
  } catch (e) {
    console.error(`qwen -p spawn threw:`, e);
    return null;
  }
}