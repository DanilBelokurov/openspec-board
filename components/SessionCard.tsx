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

  // Pick the currently-running CLI step (if any). In analyst mode both
  // steps are visible (openspec new change → gigacode /opsx-continue);
  // in developer mode the only relevant process is the Start action's
  // gigacode /opsx:plan.
  const step1Running = item.openspecNewStatus === "running";
  const step2Running = item.gigacodeContinueStatus === "running";
  const planRunning = item.gigacodeStatus === "running";

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
          {step1Running && (
            <span
              className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
              title="Создание директории change-proposal"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              openspec new change
            </span>
          )}
          {step2Running && (
            <span
              className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
              title="Создание proposal.md — gigacode /opsx-continue"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              gigacode /opsx-continue
            </span>
          )}
          {planRunning && (
            <span
              className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
              title="Планирование декомпозиции — gigacode /opsx:plan"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              gigacode
            </span>
          )}
          {/* After the current stage's CLI steps finished + the artifact
              for this stage exists on disk, and the task hasn't been
              confirmed yet → "Ожидает". Works for proposal
              (proposalReady), delta-spec (deltaSpecReady), design
              (designReady), and adr (adrReady). The stage guard
              hides the badge once the user has moved on to the next
              column — at that point the card already lives there
              and the badge is just noise. */}
          {((item.stage === "proposal" &&
            item.proposalReady &&
            !item.gigacodeError) ||
            (item.stage === "delta-spec" &&
              item.deltaSpecReady &&
              !item.deltaSpecCreateError) ||
            (item.stage === "design" &&
              item.designReady &&
              !item.designCreateError) ||
            (item.stage === "adr" &&
              item.adrReady &&
              !item.adrCreateError)) && (
              <span
                className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"
                title={
                  item.stage === "proposal"
                    ? "Proposal создан — ожидает следующего шага"
                    : item.stage === "delta-spec"
                      ? "Дельта-спецификация создана — ожидает следующего шага"
                      : item.stage === "design"
                        ? "Дизайн создан — ожидает следующего шага"
                        : "ADR создан — ожидает следующего шага"
                }
              >
                <Hourglass className="h-2.5 w-2.5" />
                Ожидает
              </span>
            )}
          {/* If any background step exited with non-zero → red error badge. */}
          {item.gigacodeError && (
            <span
              className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
              title="Один из шагов завершился с ошибкой"
            >
              <CircleAlert className="h-2.5 w-2.5" />
              ошибка
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
