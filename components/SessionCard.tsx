import Link from "next/link";
import type { ChangeSummary } from "@/lib/openspec";

interface SessionCardProps {
  item: ChangeSummary;
}

export function SessionCard({ item }: SessionCardProps) {
  return (
    <Link
      href={`/changes/${encodeURIComponent(item.changeName)}`}
      className="block"
    >
      <article className="group flex cursor-pointer flex-col gap-1 rounded-md border border-border bg-white p-2.5 shadow-card transition hover:shadow-cardHover">
        <h3 className="text-[13px] font-medium leading-snug text-slate-900">
          {item.title}
        </h3>
        <code className="text-[10px] text-slate-500">{item.changeName}</code>
      </article>
    </Link>
  );
}