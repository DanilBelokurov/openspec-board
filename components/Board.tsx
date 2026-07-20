import { Session } from "@/lib/types";
import { STAGES_ORDER, STAGE_META } from "@/lib/mock-data";
import { Column } from "./Column";

interface BoardProps {
  sessions: Session[];
}

export function Board({ sessions }: BoardProps) {
  return (
    <div className="flex h-full gap-4 overflow-x-auto px-6 py-4 scrollbar-thin">
      {STAGES_ORDER.map((stage) => (
        <Column
          key={stage}
          stage={stage}
          meta={STAGE_META[stage]}
          sessions={sessions.filter((s) => s.stage === stage)}
        />
      ))}
    </div>
  );
}