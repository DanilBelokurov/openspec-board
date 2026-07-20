import { Session } from "@/lib/types";

interface SessionCardProps {
  session: Session;
}

export function SessionCard({ session }: SessionCardProps) {
  return (
    <article className="group flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-white p-2.5 shadow-card transition hover:shadow-cardHover">
      <span className="self-start rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
        {session.id}
      </span>

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
    </article>
  );
}