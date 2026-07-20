import { TopBar } from "@/components/TopBar";
import { Board } from "@/components/Board";
import { readConfig } from "@/lib/config";
import { readState } from "@/lib/state";
import { MODES } from "@/lib/modes";
import { qwenStatusFor } from "@/lib/process";
import type { BoardItem } from "@/lib/openspec";

export default async function Home() {
  const config = await readConfig();
  const state = await readState();
  const mode = MODES[config.mode];

  const items: BoardItem[] = Object.values(state.tasks)
    .filter((t) => mode.stages.includes(t.stage))
    .map((t) => ({
      ...t.summary,
      jiraUrl: t.jiraUrl,
      codeRepoPath: t.codeRepoPath,
      qwenStatus: qwenStatusFor(t.qwenPid),
    }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <TopBar mode={config.mode} />
      <main className="flex-1 overflow-hidden">
        <Board items={items} stages={mode.stages} meta={mode.meta} />
      </main>
    </div>
  );
}