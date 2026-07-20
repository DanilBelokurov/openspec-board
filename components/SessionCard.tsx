import type { ChangeSummary } from "@/lib/openspec";

interface SessionCardProps {
  item: ChangeSummary;
}

export function SessionCard({ item }: SessionCardProps) {
  const missing: string[] = [];
  if (!item.hasProposal) missing.push("proposal.md");
  if (!item.hasDesign) missing.push("design.md");
  if (!item.hasSpecs) missing.push("specs/");

  const { added, modified, scenarios } = item.specCounts;
  const newCaps = item.newCapabilities.length;
  const modCaps = item.modifiedCapabilities.length;

  return (
    <article className="group flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-white p-2.5 shadow-card transition hover:shadow-cardHover">
      <span className="self-start rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
        {item.id}
      </span>

      <h3 className="text-[13px] font-medium leading-snug text-slate-900">
        {item.title}
      </h3>

      <code className="-mt-1 truncate rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">
        openspec/changes/{item.changeName}
      </code>

      {item.capabilityTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.capabilityTags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
        <span className="font-mono font-semibold text-emerald-700">
          +{added}
        </span>
        <span>ADDED</span>
        {modified > 0 && (
          <>
            <span className="text-slate-300">·</span>
            <span className="font-mono font-semibold text-blue-700">
              ~{modified}
            </span>
            <span>MODIFIED</span>
          </>
        )}
        <span className="text-slate-300">·</span>
        <span>{scenarios} scenarios</span>
        {newCaps > 0 && (
          <>
            <span className="text-slate-300">·</span>
            <span>{newCaps} new capability</span>
          </>
        )}
        {modCaps > 0 && (
          <>
            <span className="text-slate-300">·</span>
            <span>{modCaps} modified</span>
          </>
        )}
      </div>

      {missing.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[10px] text-amber-800">
          ⚠ Нет артефактов: {missing.join(", ")}
        </div>
      )}
    </article>
  );
}