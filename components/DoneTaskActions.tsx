"use client";

import { useState } from "react";
import { CheckCheck, Pencil } from "lucide-react";
import { ReopenTaskDialog } from "./ReopenTaskDialog";
import { DeleteTaskDialog } from "./DeleteTaskDialog";

interface DoneTaskActionsProps {
  tag: string;
  /**
   * Tag of the parent plan this task is a child of, if any.
   * Surfaced through the close dialog as the optional
   * "Также удалить родительский план" checkbox. Omit when
   * the task is a top-level entry with no parent.
   */
  parentTag?: string;
}

/**
 * Two-button cluster rendered on the detail page when a task is
 * in stage "done" (mode "analyst"). These are the only actions
 * available past the final "Подтверждено" press:
 *
 *   - "Закрыть" (emerald) — opens DeleteTaskDialog, which on
 *     confirm tears down the worktree, deletes the local
 *     feature/<JIRA-ID> branch, ALWAYS runs
 *     `git push origin --delete <branch>` (forceDeleteRemote),
 *     and removes the state.json entry. The word "close" reads
 *     as the natural end of a change-proposal lifecycle, even
 *     though mechanically it's a destructive delete. The
 *     remote cleanup is mandatory at this stage because the
 *     branch was published + a PR was opened by definition.
 *
 *   - "Редактировать" (amber) — opens ReopenTaskDialog, which
 *     picks a stage to revert to + collects a free-form comment
 *     and POSTs to /api/changes/<tag>/reopen. The server wipes the
 *     artefacts at and after the chosen stage, rewinds task.stage,
 *     and spawns a detached gigacode --prompt re-run with the
 *     comment folded in.
 */
export function DoneTaskActions({ tag, parentTag }: DoneTaskActionsProps) {
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setCloseOpen(true)}
          title="Закрыть задачу (удалить worktree, ветку, запись в state.json)"
          aria-label="Закрыть задачу"
          className="flex h-7 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          <span>Закрыть</span>
        </button>
        <button
          type="button"
          onClick={() => setReopenOpen(true)}
          title="Вернуть задачу на более ранний этап с переписыванием артефакта"
          aria-label="Редактировать задачу"
          className="flex h-7 items-center gap-1.5 rounded-md bg-amber-500 px-3 text-[12px] font-medium text-white hover:bg-amber-600"
        >
          <Pencil className="h-3.5 w-3.5" />
          <span>Редактировать</span>
        </button>
      </div>
      <DeleteTaskDialog
        open={closeOpen}
        tag={tag}
        accent="emerald"
        actionLabel="Закрыть"
        title="Закрыть задачу"
        hint="Это рассматривается как завершение жизненного цикла изменения: артефакты остаются в worktree до явного закрытия."
        forceDeleteRemote
        hasParent={parentTag != null}
        parentTag={parentTag}
        onClose={() => setCloseOpen(false)}
      />
      <ReopenTaskDialog
        open={reopenOpen}
        tag={tag}
        fromStage="done"
        onClose={() => setReopenOpen(false)}
      />
    </div>
  );
}
