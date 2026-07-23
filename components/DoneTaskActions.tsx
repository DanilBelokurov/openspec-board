"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Pencil, Loader2 } from "lucide-react";
import { ReopenTaskDialog } from "./ReopenTaskDialog";

interface DoneTaskActionsProps {
  tag: string;
}

/**
 * Two-button cluster rendered on the detail page when a task is
 * in stage "done" (mode "analyst"). These are the only actions
 * available past the final "Подтверждено" press:
 *
 *   - "Закрыть" (emerald) — the same teardown as the generic
 *     "Удалить" button: drop the worktree, delete the
 *     feature/<JIRA-ID> branch, remove the entry from state.json.
 *     The word "close" reads as the natural end of a change-
 *     proposal lifecycle, even though mechanically it's a
 *     destructive delete.
 *
 *   - "Редактировать" (amber) — opens ReopenTaskDialog, which
 *     picks a stage to revert to + collects a free-form comment
 *     and POSTs to /api/changes/<tag>/reopen. The server wipes the
 *     artefacts at and after the chosen stage, rewinds task.stage,
 *     and spawns a detached gigacode --prompt re-run with the
 *     comment folded in.
 */
export function DoneTaskActions({ tag }: DoneTaskActionsProps) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);

  async function handleClose() {
    const ok = window.confirm(
      `Закрыть задачу "${tag}"?\n` +
        `Будет удалён worktree, ветка feature/<JIRA-ID> и запись в state.json. Это действие нельзя отменить.`,
    );
    if (!ok) return;
    setClosing(true);
    setCloseError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/delete`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setCloseError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push("/");
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : String(e));
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleClose}
          disabled={closing}
          title="Закрыть задачу (удалить worktree, ветку, запись в state.json)"
          aria-label="Закрыть задачу"
          className="flex h-7 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
        >
          {closing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCheck className="h-3.5 w-3.5" />
          )}
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
      {closeError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] text-red-700">
          {closeError}
        </div>
      )}

      <ReopenTaskDialog
        open={reopenOpen}
        tag={tag}
        onClose={() => setReopenOpen(false)}
      />
    </div>
  );
}