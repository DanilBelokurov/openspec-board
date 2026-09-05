"use client";

import { useState } from "react";
import { Trash2, Copy } from "lucide-react";
import { useCreateProposal } from "./CreateProposalContext";
import { DeleteTaskDialog } from "./DeleteTaskDialog";

interface TaskActionsProps {
  tag: string;
  title: string;
  description?: string;
  jiraUrl?: string;
  /**
   * Tag of the parent plan this task is a child of, if any.
   * Surfaced through the delete dialog as the optional
   * "Также удалить родительский план" checkbox. Omit when
   * the task is a top-level entry with no parent.
   */
  parentTag?: string;
}

/**
 * Small action buttons for the detail page header — "Копировать"
 * (clone the task into a fresh create-dialog with the same
 * title / description / jiraUrl) and "Удалить" (drop the worktree,
 * branch, and state.json entry).
 *
 * "Удалить" opens DeleteTaskDialog — a confirmation modal with a
 * "Также удалить ветку в origin" checkbox that defaults to OFF.
 * The dialog only appears after a click, so the option doesn't
 * clutter the page when the user has no intent to delete.
 */
export function TaskActions({
  tag,
  title,
  description,
  jiraUrl,
  parentTag,
}: TaskActionsProps) {
  const createProposal = useCreateProposal();
  const [deleteOpen, setDeleteOpen] = useState(false);

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
          onClick={() => setDeleteOpen(true)}
          title="Удалить задачу, worktree и ветку"
          aria-label="Удалить задачу, worktree и ветку"
          className="flex h-7 items-center gap-1.5 rounded-md border border-red-300 bg-white px-2.5 text-[12px] font-medium text-red-700 hover:bg-red-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Удалить</span>
        </button>
      </div>
      <DeleteTaskDialog
        open={deleteOpen}
        tag={tag}
        accent="red"
        actionLabel="Удалить"
        title="Удалить задачу"
        hasParent={parentTag != null}
        parentTag={parentTag}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
