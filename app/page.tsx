import { TopBar } from "@/components/TopBar";
import { Board } from "@/components/Board";
import { readState } from "@/lib/state";
import type { BoardItem } from "@/lib/openspec";

export default async function Home() {
  const state = await readState();
  const items: BoardItem[] = Object.values(state.tasks).map((t) => ({
    ...t.summary,
    jiraUrl: t.jiraUrl,
    codeRepoPath: t.codeRepoPath,
  }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <TopBar />
      <main className="flex-1 overflow-hidden">
        <Board items={items} />
      </main>
    </div>
  );
}