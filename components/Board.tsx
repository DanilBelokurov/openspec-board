import type { BoardItem } from "@/lib/openspec";
import { STAGES_ORDER, STAGE_META } from "@/lib/mock-data";
import { Column } from "./Column";

interface BoardProps {
  items: BoardItem[];
}

export function Board({ items }: BoardProps) {
  return (
    <div className="flex h-full gap-4 overflow-x-auto px-6 py-4 scrollbar-thin">
      {STAGES_ORDER.map((stage) => (
        <Column
          key={stage}
          stage={stage}
          meta={STAGE_META[stage]}
          items={items.filter((it) => it.stage === stage)}
        />
      ))}
    </div>
  );
}