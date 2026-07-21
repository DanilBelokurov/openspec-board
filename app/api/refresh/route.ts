import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { scanChanges } from "@/lib/openspec";
import { mergeScanWithState } from "@/lib/state";
import { triggerContinueIfNeeded } from "@/lib/continuation";

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

    // Also trigger /opsx-continue for any proposal-stage task whose
    // .openspec.yaml is on disk but proposal.md isn't yet.
    // (Same trigger also runs from server components on every page load,
    // so this is mostly belt-and-braces for the explicit refresh case.)
    const continued = await triggerContinueIfNeeded(config.openspecDir);

    // Re-read after the continue-trigger updates may have written changes.
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