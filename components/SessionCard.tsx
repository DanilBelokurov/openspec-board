import { MessageSquare, CalendarDays } from "lucide-react";
import { Session, Priority } from "@/lib/types";

interface SessionCardProps {
  session: Session;
}

const PRIORITY_META: Record<Priority, { color: string; label: string }> = {
  low: { color: "bg-slate-400", label: "Low" },
  medium: { color: "bg-blue-400", label: "Medium" },
  high: { color: "bg-orange-500", label: "High" },
  urgent: { color: "bg-red-500", label: "Urgent" },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function SessionCard({ session }: SessionCardProps) {
  const pMeta = PRIORITY_META[session.priority];
  const pct =
    session.tasksProgress.total > 0
      ? (session.tasksProgress.done / session.tasksProgress.total) * 100
      : 0;

  return (
    <article className="group flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-white p-2.5 shadow-card transition hover:shadow-cardHover">
      <div className="flex items-center justify-between">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
          {session.id}
        </span>
        <span className="flex items-center gap-1 text-[10px] font-medium text-slate-600">
          <span className={`h-1.5 w-1.5 rounded-full ${pMeta.color}`} />
          {pMeta.label}
        </span>
      </div>

      <h3 className="text-[13px] font-medium leading-snug text-slate-900">
        {session.title}
      </h3>

      <code className="-mt-1 truncate rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">
        openspec/changes/{session.changeName}
      </code>

      {session.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {session.labels.map((label) => (
            <span
              key={label.name}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: `${label.color}1a`,
                color: label.color,
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-slate-700 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="tabular-nums text-[10px] font-medium text-slate-500">
          {session.tasksProgress.done}/{session.tasksProgress.total}
        </span>
      </div>

      <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ backgroundColor: session.assignee.color }}
          >
            {session.assignee.initials}
          </span>
          <span className="flex items-center gap-0.5">
            <CalendarDays className="h-3 w-3" />
            {formatDate(session.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <MessageSquare className="h-3 w-3" />
          <span className="tabular-nums">{session.comments}</span>
        </div>
      </div>
    </article>
  );
}