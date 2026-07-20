import { TopBar } from "@/components/TopBar";
import { Board } from "@/components/Board";
import { readState } from "@/lib/state";

export default async function Home() {
  const state = await readState();
  const items = Object.values(state.tasks).map((t) => t.summary);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <TopBar />
      <main className="flex-1 overflow-hidden">
        <Board items={items} />
      </main>
    </div>
  );
}