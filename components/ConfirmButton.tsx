"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCheck,
  Loader2,
  Pencil,
  X,
  Send,
} from "lucide-react";

interface ConfirmArtifactButtonProps {
  tag: string;
  stage: "proposal" | "delta-spec" | "design";
  title: string;
  artifactLabel: string;
  artifactHint: string;
}

/**
 * Two-mode card: (1) green check + "Подтверждено" advances the task
 * to the next analyst-mode stage; (2) pencil reveals an inline
 * textarea where the analyst can request changes to the generated
 * artifact. The pencil posts to a stage-specific update endpoint
 * (update-proposal / update-delta-spec), which re-runs gigacode
 * --prompt with the user's request folded in.
 *
 * On a successful confirm we router.push("/") so the analyst lands
 * back on the board and sees the task in its new column.
 */
export function ConfirmArtifactButton({
  tag,
  stage,
  title,
  artifactLabel,
  artifactHint,
}: ConfirmArtifactButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [updating, setUpdating] = useState(false);

  function openEditor() {
    setEditing(true);
    setEditValue("");
    setError(null);
  }

  function cancelEdit() {
    setEditing(false);
    setEditValue("");
  }

  async function submitEdit() {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/update-${stage}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comments: trimmed }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Collapse the editor; the artifact-update pipeline runs in
      // the background and writes the updated files to the
      // worktree. router.refresh() makes the new file content show
      // up immediately in the file tree on the detail page.
      setEditing(false);
      setEditValue("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdating(false);
    }
  }

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/confirm`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-900">
      <div className="flex items-center gap-3">
        <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
        <div className="flex-1">
          <div className="font-semibold">{title}</div>
          <div className="mt-0.5 text-[11px] text-emerald-800/80">
            Файл <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[10px]">{artifactLabel}</code> создан в{" "}
            <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[10px]">
              {tag}
            </code>
            . {artifactHint}
          </div>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={openEditor}
            title="Запросить изменения"
            aria-label="Запросить изменения"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={handleClick}
          disabled={submitting || editing}
          className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCheck className="h-3.5 w-3.5" />
          )}
          <span>Подтверждено</span>
        </button>
      </div>

      {editing && (
        <div className="mt-3 space-y-2 border-t border-emerald-200/70 pt-3">
          <label
            htmlFor={`artifact-edit-${stage}-${tag}`}
            className="block text-[11px] font-medium text-emerald-900/80"
          >
            Что изменить?
          </label>
          <textarea
            id={`artifact-edit-${stage}-${tag}`}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={
              stage === "proposal"
                ? "Например: «добавь раздел про риски», «уточни scope», «опиши как мы будем мерять успех»"
                : stage === "delta-spec"
                  ? "Например: «добавь требование про логирование», «уточни WHEN/THEN у сценария X», «убери лишнее требование»"
                  : "Например: «опиши альтернативу Y подробнее», «добавь диаграмму последовательности», «убери избыточное обсуждение Z»"
            }
            rows={3}
            autoFocus
            disabled={updating}
            className="w-full rounded-md border border-emerald-300 bg-white px-2 py-1.5 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-300 disabled:bg-slate-50"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={updating}
              className="flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              <span>Отмена</span>
            </button>
            <button
              type="button"
              onClick={submitEdit}
              disabled={updating || editValue.trim().length === 0}
              className="flex h-7 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {updating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>Отправить</span>
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}