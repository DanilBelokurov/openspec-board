import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { scanChanges } from "@/lib/openspec";
import { mergeScanWithState } from "@/lib/state";

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
    const tasks = Object.values(state.tasks);
    return NextResponse.json({
      scanned: summaries.length,
      total: tasks.length,
      tasks,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Не удалось обновить: ${String(e)}` },
      { status: 500 },
    );
  }
}