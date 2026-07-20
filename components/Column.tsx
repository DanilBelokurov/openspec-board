import {
  Inbox,
  GitBranch,
  ClipboardList,
  Code2,
  TestTube2,
  Rocket,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { Session, Stage, StageMeta } from "@/lib/types";
import { SessionCard } from "./SessionCard";

interface ColumnProps {
  stage: Stage;
  meta: StageMeta;
  sessions: Session[];
}

const ICON_MAP: Record<string, LucideIcon> = {
  Inbox,
  GitBranch,
  ClipboardList,
  Code2,
  TestTube2,
  Rocket,
  CheckCircle2,
};

const STAGE_DOT: Record<Stage, string> = {
  backlog: "bg-stage-backlog",
  decomposition: "bg-stage-decomposition",
  plan: "bg-stage-plan",
  develop: "bg-stage-develop",
  tests: "bg-stage-tests",
  deploy: "bg-stage-deploy",
  done: "bg-stage-done",
};

export function Column({ stage, meta, sessions }: ColumnProps) {
  const Icon = ICON_MAP[meta.icon];
  return (
    <section className="flex h-full w-[290px] shrink-0 flex-col rounded-lg bg-slate-100/60">
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className={`h-2 w-2 rounded-full ${STAGE_DOT[stage]}`} />
        <Icon className="h-3.5 w-3.5 text-slate-600" />
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-slate-700">
          {meta.label}
        </h2>
        <span className="ml-1 rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
          {sessions.length}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 scrollbar-thin">
        {sessions.map((session) => (
          <SessionCard key={session.id} session={session} />
        ))}
        {sessions.length === 0 && (
          <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-slate-400">
            No sessions
          </div>
        )}
      </div>
    </section>
  );
}