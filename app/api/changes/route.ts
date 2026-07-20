import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { readConfig } from "@/lib/config";
import { readState, writeState } from "@/lib/state";
import { qwenStatusFor } from "@/lib/process";
import { slugify, uniqueSlug } from "@/lib/slug";

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

  // Spawn qwen headless with the proposal description
  const qwenPid = spawnProposalQwen(description);

  if (qwenPid != null) {
    next.tasks[changeName] = { ...newTask, qwenPid };
    await writeState(next);
  }

  return NextResponse.json(
    {
      created: true,
      task: next.tasks[changeName],
      qwenStatus: qwenStatusFor(qwenPid),
    },
    { status: 201 },
  );
}

function spawnProposalQwen(description: string): number | null {
  try {
    const child = spawn("qwen", ["/opsx-new", description], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (err) => {
      console.error(`qwen /opsx-new spawn error:`, err.message);
    });
    child.unref();
    return child.pid ?? null;
  } catch (e) {
    console.error(`qwen /opsx-new spawn threw:`, e);
    return null;
  }
}