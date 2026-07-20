import type { BoardItem, Stage } from "@/lib/openspec";
import type { StageMeta, BoardModeId } from "@/lib/modes";
import { Column } from "./Column";

interface BoardProps {
  items: BoardItem[];
  stages: Stage[];
  meta: Record<string, StageMeta>;
  mode: BoardModeId;
}

export function Board({ items, stages, meta, mode }: BoardProps) {
  return (
    <div className="flex h-full gap-3 overflow-x-auto px-4 py-3 scrollbar-thin">
      {stages.map((stage) => (
        <Column
          key={stage}
          stage={stage}
          meta={meta[stage]}
          items={items.filter((it) => it.stage === stage)}
          mode={mode}
        />
      ))}
    </div>
  );
}