"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Copy, Loader2 } from "lucide-react";
import { useCreateProposal } from "./CreateProposalContext";

interface TaskActionsProps {
  tag: string;
  title: string;
  description?: string;
  jiraUrl?: string;
}

/**
 * Small action buttons for the detail page header — "Копировать"
 * (clone the task into a fresh create-dialog with the same
 * title / description / jiraUrl) and "Удалить" (drop the worktree,
 * branch, and state.json entry).
 */
export function TaskActions({
  tag,
  title,
  description,
  jiraUrl,
}: TaskActionsProps) {
  const router = useRouter();
  const createProposal = useCreateProposal();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    const ok = window.confirm(
      `Удалить задачу "${tag}"?\n` +
        `Будет удалён worktree, ветка feature/<JIRA-ID> и запись в state.json. Это действие нельзя отменить.`,
    );
    if (!ok) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/delete`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Bounce back to the board — the task no longer exists.
      router.push("/");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  function handleCopy() {
    // Open the global CreateProposalDialog with this task's title /
    // description / jiraUrl pre-filled. The tag field is left empty
    // in the dialog so the user has to choose a fresh one (two
    // changes cannot share a tag).
    createProposal.open({
      title,
      description: description ?? "",
      jiraUrl: jiraUrl ?? "",
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          title="Создать новую задачу на основе этой"
          aria-label="Создать новую задачу на основе этой"
          className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
        >
          <Copy className="h-3.5 w-3.5" />
          <span>Копировать</span>
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          title="Удалить задачу, worktree и ветку"
          aria-label="Удалить задачу, worktree и ветку"
          className="flex h-7 items-center gap-1.5 rounded-md border border-red-300 bg-white px-2.5 text-[12px] font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          <span>Удалить</span>
        </button>
      </div>
      {deleteError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] text-red-700">
          {deleteError}
        </div>
      )}
    </div>
  );
}