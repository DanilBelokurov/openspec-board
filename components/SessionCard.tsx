import Link from "next/link";
import { ExternalLink, FolderGit2, Loader2, CheckCircle2 } from "lucide-react";
import type { BoardItem } from "@/lib/openspec";
import { extractJiraId, repoBasename } from "@/lib/git";

interface SessionCardProps {
  item: BoardItem;
}

export function SessionCard({ item }: SessionCardProps) {
  const missing: string[] = [];
  if (!item.hasProposal) missing.push("proposal.md");
  if (!item.hasDesign) missing.push("design.md");
  if (!item.hasSpecs) missing.push("specs/");

  const jiraId = item.jiraUrl ? extractJiraId(item.jiraUrl) : null;
  const repoName = item.codeRepoPath ? repoBasename(item.codeRepoPath) : null;

  return (
    <Link
      href={`/changes/${encodeURIComponent(item.changeName)}`}
      className="block"
    >
      <article className="group flex cursor-pointer flex-col gap-1.5 rounded-md border border-border bg-white p-2.5 shadow-card transition hover:shadow-cardHover">
        <h3 className="text-[13px] font-medium leading-snug text-slate-900">
          {item.title}
        </h3>
        <code className="text-[10px] text-slate-500">{item.changeName}</code>
        <div className="flex flex-wrap gap-1">
          {item.qwenStatus === "running" && (
            <span
              className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
              title="qwen-процесс запущен"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              qwen
            </span>
          )}
          {item.qwenStatus === "stopped" && (
            <span
              className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
              title="qwen-процесс завершён"
            >
              <CheckCircle2 className="h-2.5 w-2.5" />
              qwen
            </span>
          )}
          {jiraId && (
            <span
              className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"
              title={item.jiraUrl}
            >
              {jiraId}
            </span>
          )}
          {repoName && (
            <span
              className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
              title={item.codeRepoPath}
            >
              <FolderGit2 className="h-2.5 w-2.5" />
              {repoName}
            </span>
          )}
        </div>
        {missing.length > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[10px] text-amber-800">
            ⚠ Нет артефактов: {missing.join(", ")}
          </div>
        )}
      </article>
    </Link>
  );
}