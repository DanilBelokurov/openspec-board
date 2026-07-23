"use client";

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
import { extractJiraId } from "@/lib/jira";
import { repoBasename } from "@/lib/path-utils";

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
        <div className="flex flex-wrap gap-1">
          {/* Unified pipeline-status badge. Computed server-side via
              lib/openspec.ts → pipelineStatus() so it works for
              every stage that has a pipeline (proposal /
              delta-spec / design / adr in analyst mode, and the
              /opsx:plan stages in developer mode). */}
          {item.pipelineStatus === "running" && (
            <span
              className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
              title={`Этап «${item.stage}» — идёт работа`}
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              выполняется
            </span>
          )}
          {item.pipelineStatus === "error" && (
            <span
              className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
              title={`Этап «${item.stage}» — один из шагов завершился с ошибкой`}
            >
              <CircleAlert className="h-2.5 w-2.5" />
              ошибка
            </span>
          )}
          {item.pipelineStatus === "waiting" && (
            <span
              className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"
              title={
                item.stage === "proposal"
                  ? "Proposal создан — ожидает подтверждения"
                  : item.stage === "delta-spec"
                    ? "Дельта-спецификация создана — ожидает подтверждения"
                    : item.stage === "design"
                      ? "Дизайн создан — ожидает подтверждения"
                      : item.stage === "adr"
                        ? "ADR создан — ожидает подтверждения"
                        : `${item.stage} создан — ожидает подтверждения`
              }
            >
              <Hourglass className="h-2.5 w-2.5" />
              ожидает
            </span>
          )}
          {item.archived && (
            <span
              className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
              title="Change-proposal архивирован upstream — закройте задачу вручную"
            >
              архив
            </span>
          )}
          {jiraId && (
            // Use <button> not <a> here: nested <a> inside the outer <Link>
            // causes the browser's "active formatting elements" rule to close
            // the outer <a> early, which breaks the DOM structure that React
            // expects and triggers a hydration mismatch error.
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                window.open(item.jiraUrl!, "_blank", "noopener,noreferrer");
              }}
              className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
              title={item.jiraUrl}
            >
              {jiraId}
              <ExternalLink className="h-2.5 w-2.5" />
            </button>
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
