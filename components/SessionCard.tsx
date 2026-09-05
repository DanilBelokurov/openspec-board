"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ExternalLink,
  FolderGit2,
  Loader2,
  CheckCircle2,
  CircleAlert,
  Hourglass,
  User,
  GitBranch,
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
  const router = useRouter();
  const missing: string[] = [];
  if (!item.hasProposal) missing.push("proposal.md");
  if (!item.hasDesign) missing.push("design.md");
  if (!item.hasSpecs) missing.push("specs/");

  const jiraId = item.jiraId ?? (item.jiraUrl ? extractJiraId(item.jiraUrl) : null);
  const repoName = item.codeRepoPath ? repoBasename(item.codeRepoPath) : null;
  // Short SHA prefix (first 7 chars) — what GitHub / Bitbucket
  // show in their branch UI. Cheap to compute, lets the user
  // cross-reference the commit on the forge.
  const shortSha = item.sourceCommit
    ? item.sourceCommit.slice(0, 7)
    : null;

  return (
    <Link
      href={`/changes/${encodeURIComponent(item.changeName)}`}
      className="block"
    >
      <article
        // Remote tasks get a subtle left border tint so the user
        // can scan a column and immediately see "these are NOT
        // mine, I just observe them". The amber border matches
        // the "Нет артефактов" warning color elsewhere in the UI
        // for visual consistency.
        className={`group flex cursor-pointer flex-col gap-1.5 rounded-md border bg-white p-2.5 shadow-card transition hover:shadow-cardHover ${
          item.remote
            ? "border-amber-300/70 border-l-[3px]"
            : "border-border"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[13px] font-medium leading-snug text-slate-900">
            {item.title}
          </h3>
          {/* "remote" badge in the corner — small, non-intrusive.
              Shown only when the task was discovered from a
              remote-tracking ref. Clicking the badge is a no-op
              (the surrounding card handles navigation); we keep
              it visible at all times so the user doesn't have to
              hover to discover "why is this card here". */}
          {item.remote && (
            <span
              className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
              title={`Proposal опубликован другим пользователем. Автор: ${item.publishedBy?.name ?? "?"} <${item.publishedBy?.email ?? "?"}>. Открыт только для чтения — редактирование появится в следующих версиях.`}
            >
              remote
            </span>
          )}
        </div>
        {/* The kebab-case tag is shown as a small code label only
            when it differs from the displayed title. Developer-mode
            tasks use the tag as their title (the canonical
            identifier for the dev workflow — worktree paths,
            branch names, git refs), so showing the tag a second
            time below would be redundant. Analyst tasks keep the
            user-provided prose title and the tag lives below it. */}
        {item.title !== item.changeName && (
          <code className="break-all text-[10px] text-slate-500">
            {item.changeName}
          </code>
        )}
        {/* For child develop tasks, show a small "↑ от
            <parentTag>" subheading so the dev sees the parent
            relationship at a glance. Without this, a card
            titled "article-service" looks like its own change
            when it's actually a sub-task of
            "add-articles-metrics". IMPORTANT: must be a
            <button>, NOT a <Link>. The outer card is itself
            a <Link> (Next.js renders it as <a>); nesting a
            second <a> inside violates HTML's "active
            formatting elements" rule — the browser closes
            the outer <a> early, which trips a Next.js
            hydration mismatch. This is the same trap the
            Jira badge fell into a few commits back. */}
        {item.parentTag && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              router.push(
                `/changes/${encodeURIComponent(item.parentTag!)}`,
              );
            }}
            className="block w-fit text-left text-[10px] text-slate-500 hover:text-slate-700 hover:underline"
            title={`Sub-task от change-proposal «${item.parentTag}» — кликните, чтобы перейти к плану`}
          >
            ↑ от {item.parentTag}
          </button>
        )}
        {/* Multi-user author row: visible only on remote tasks.
            Renders the git author of the tip commit with their
            email on hover. The full SHA is shown as a
            monospace label for cross-reference with the forge
            UI. Both labels are non-interactive — clicking the
            card navigates to the change detail page (where the
            "open on forge" link will live). */}
        {item.remote && item.publishedBy && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
            <span
              className="inline-flex items-center gap-1"
              title={`Автор ветки: ${item.publishedBy.name} <${item.publishedBy.email}>`}
            >
              <User className="h-2.5 w-2.5" />
              <span className="font-medium text-slate-700">
                {item.publishedBy.name}
              </span>
            </span>
            {shortSha && (
              <span
                className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-500"
                title={`Tip commit: ${item.sourceCommit}\nВетка: ${item.remoteBranch ?? "?"}`}
              >
                <GitBranch className="h-2.5 w-2.5" />
                {shortSha}
              </span>
            )}
          </div>
        )}
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
        {missing.length > 0 && mode === "developer" && !item.parentTag && (
          <div className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[10px] text-amber-800">
            ⚠ Нет артефактов: {missing.join(", ")}
          </div>
        )}
        {/* Read-only hint for remote tasks without local artifacts.
            Only surfaced when the user might otherwise wonder
            "why can't I click anything" — namely when proposal.md
            (the entry artifact) is reported missing by the local
            filesystem check OR when this is a remote task without
            any local worktree to host a pipeline-status badge. */}
        {item.remote && !item.hasProposal && (
          <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-[10px] text-slate-600">
            ℹ Только для чтения — proposal ещё не опубликован в origin
          </div>
        )}
      </article>
    </Link>
  );
}
