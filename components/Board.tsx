import type { BoardItem, Stage } from "@/lib/openspec";
import type { StageMeta } from "@/lib/modes";
import { Column } from "./Column";

interface BoardProps {
  items: BoardItem[];
  stages: Stage[];
  meta: Record<string, StageMeta>;
}

export function Board({ items, stages, meta }: BoardProps) {
  return (
    <div className="flex h-full gap-4 overflow-x-auto px-6 py-4 scrollbar-thin">
      {stages.map((stage) => (
        <Column
          key={stage}
          stage={stage}
          meta={meta[stage]}
          items={items.filter((it) => it.stage === stage)}
        />
      ))}
    </div>
  );
}