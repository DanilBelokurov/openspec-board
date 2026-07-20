import { TopBar } from "@/components/TopBar";
import { Board } from "@/components/Board";
import { sessions } from "@/lib/mock-data";

export default function Home() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <TopBar />
      <main className="flex-1 overflow-hidden">
        <Board sessions={sessions} />
      </main>
    </div>
  );
}