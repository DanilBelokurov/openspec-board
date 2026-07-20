import { TopBar } from "@/components/TopBar";
import { Board } from "@/components/Board";
import { readConfig } from "@/lib/config";
import { scanChanges } from "@/lib/openspec";

export default async function Home() {
  const config = await readConfig();
  let items: Awaited<ReturnType<typeof scanChanges>> = [];

  if (config.openspecDir) {
    try {
      items = await scanChanges(config.openspecDir);
    } catch (e) {
      console.error("scanChanges failed:", e);
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <TopBar />
      <main className="flex-1 overflow-hidden">
        <Board items={items} />
      </main>
    </div>
  );
}