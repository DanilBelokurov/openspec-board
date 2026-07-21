import Link from "next/link";
import {
  ExternalLink,
  FolderGit2,
  Loader2,
  CheckCircle2,
  CircleAlert,
  Hourglass,
} from "lucide-react";
import type { BoardItem } from "@/lib/openspec";
import type { BoardModeId } from "@/lib/modes";
import { extractJiraId, repoBasename } from "@/lib/git";

interface SessionCardProps {
  item: BoardItem;
  mode: BoardModeId;
}

export function SessionCard({ item, mode }: SessionCardProps) {
  const missing: string[] = [];
  if (!item.hasProposal) missing.push("proposal.md");
  if (!item.hasDesign) missing.push("design.md");
  if (!item.hasSpecs) missing.push("specs/");

  const jiraId = item.jiraId ?? (item.jiraUrl ? extractJiraId(item.jiraUrl) : null);
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
        <code className="break-all text-[10px] text-slate-500">
          {item.changeName}
        </code>
        {item.tag && (
          <div className="-mt-1 text-[10px] font-mono text-slate-400">
            #{item.tag}
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {/* gigacode status — only when there's a gigacode process for this task */}
          {item.gigacodeStatus === "running" && (
            <span
              className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
              title="gigacode-процесс запущен"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              gigacode
            </span>
          )}
          {item.gigacodeStatus === "stopped" && !item.gigacodeError && (
            <span
              className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
              title="gigacode-процесс завершён"
            >
              <CheckCircle2 className="h-2.5 w-2.5" />
              gigacode
            </span>
          )}
          {/* After both gigacodes finished + proposal.md exists → "Ожидает".
              Per user spec: replaces the gigacode badge. */}
          {item.proposalReady && !item.gigacodeError && (
            <span
              className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"
              title="Proposal создан — ожидает следующего шага"
            >
              <Hourglass className="h-2.5 w-2.5" />
              Ожидает
            </span>
          )}
          {/* If any gigacode exited with non-zero → red error badge. */}
          {item.gigacodeError && (
            <span
              className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
              title="gigacode завершился с ошибкой"
            >
              <CircleAlert className="h-2.5 w-2.5" />
              ошибка gigacode
            </span>
          )}
          {jiraId && (
            <a
              href={item.jiraUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
              title={item.jiraUrl}
            >
              {jiraId}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
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
        {missing.length > 0 && mode === "developer" && (
          <div className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[10px] text-amber-800">
            ⚠ Нет артефактов: {missing.join(", ")}
          </div>
        )}
      </article>
    </Link>
  );
}