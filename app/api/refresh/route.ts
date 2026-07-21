import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { readConfig } from "@/lib/config";
import { scanChanges } from "@/lib/openspec";
import { mergeScanWithState, updateTask } from "@/lib/state";
import type { TaskEntry } from "@/lib/state";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function spawnContinueQwen(changePath: string): number | null {
  try {
    const child = spawn("qwen", ["-p", `/opsx-continue ${changePath}`], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (err) => {
      console.error(`qwen -p /opsx-continue spawn error for ${changePath}:`, err.message);
    });
    child.unref();
    return child.pid ?? null;
  } catch (e) {
    console.error(`qwen -p /opsx-continue spawn threw for ${changePath}:`, e);
    return null;
  }
}

async function maybeTriggerContinue(
  tasks: Record<string, TaskEntry>,
  openspecDir: string,
): Promise<string[]> {
  const triggered: string[] = [];
  for (const [changeName, task] of Object.entries(tasks)) {
    if (task.stage !== "proposal") continue;
    if (task.qwenContinuePid) continue; // already spawned

    const changePath = path.join(openspecDir, "changes", changeName);
    if (!(await exists(changePath))) continue;
    if (!(await exists(path.join(changePath, ".openspec.yaml")))) continue;
    if (await exists(path.join(changePath, "proposal.md"))) continue;

    const pid = spawnContinueQwen(changePath);
    if (pid != null) {
      await updateTask(changeName, {
        qwenContinuePid: pid,
        qwenContinueStartedAt: new Date().toISOString(),
      });
      triggered.push(changeName);
    } else {
      console.error(`Failed to spawn qwen /opsx-continue for ${changeName}`);
    }
  }
  return triggered;
}

export async function POST() {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "Сначала укажите директорию OpenSpec store в настройках" },
      { status: 400 },
    );
  }

  try {
    const summaries = await scanChanges(config.openspecDir);
    const state = await mergeScanWithState(summaries);

    // After the basic scan, walk tasks and trigger /opsx-continue for any
    // proposal-stage task whose .openspec.yaml already exists on disk but
    // proposal.md doesn't yet (i.e. the first qwen /opsx-new finished).
    const continued = await maybeTriggerContinue(
      state.tasks,
      config.openspecDir,
    );

    // Re-read state to pick up updates from continue-trigger.
    const final = await mergeScanWithState(
      await scanChanges(config.openspecDir),
    );

    return NextResponse.json({
      scanned: summaries.length,
      total: Object.keys(final.tasks).length,
      continued,
      tasks: Object.values(final.tasks),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Не удалось обновить: ${String(e)}` },
      { status: 500 },
    );
  }
}