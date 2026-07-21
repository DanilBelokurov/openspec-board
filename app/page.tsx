import "@/lib/watcher"; // side-effect: starts background polling for /opsx-continue
import { TopBar } from "@/components/TopBar";
import { Board } from "@/components/Board";
import { readConfig } from "@/lib/config";
import { readState } from "@/lib/state";
import { triggerContinueIfNeeded } from "@/lib/continuation";
import { MODES } from "@/lib/modes";
import { gigacodeStatusFor } from "@/lib/process";
import type { BoardItem } from "@/lib/openspec";

export default async function Home() {
  const config = await readConfig();
  if (!config.openspecDir) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-surface">
        <TopBar mode={config.mode} />
        <main className="flex-1 overflow-hidden">
          <div className="flex h-full items-center justify-center text-[13px] text-slate-500">
            Укажите директорию OpenSpec store в настройках (⚙)
          </div>
        </main>
      </div>
    );
  }

  // Fire-and-forget on every board render (cheap when nothing to do;
  // becomes meaningful when a proposal task is waiting for /opsx-continue).
  await triggerContinueIfNeeded(config.openspecDir);

  const state = await readState();
  const mode = MODES[config.mode];

  const items: BoardItem[] = Object.values(state.tasks)
    .filter((t) => mode.stages.includes(t.stage))
    .map((t) => ({
      ...t.summary,
      jiraUrl: t.jiraUrl,
      codeRepoPath: t.codeRepoPath,
      gigacodeStatus: gigacodeStatusFor(t.gigacodePid),
    }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <TopBar mode={config.mode} />
      <main className="flex-1 overflow-hidden">
        <Board
          items={items}
          stages={mode.stages}
          meta={mode.meta}
          mode={config.mode}
        />
      </main>
    </div>
  );
}