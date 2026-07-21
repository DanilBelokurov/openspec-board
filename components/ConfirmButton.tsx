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

interface ConfirmButtonProps {
  tag: string;
}

export function ConfirmButton({ tag }: ConfirmButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline edit-mode: pencil button toggles a textarea where the
  // analyst can request changes to the generated proposal. The
  // "Отправить" submit is currently a no-op — wiring the request
  // into the gigacode --prompt payload will land in a follow-up
  // change.
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  function openEditor() {
    setEditing(true);
    setEditValue("");
    setError(null);
  }

  function cancelEdit() {
    setEditing(false);
    setEditValue("");
  }

  function submitEdit() {
    // TODO: pass editValue into the gigacode --prompt for the
    // proposal-edit step (planned follow-up change). For now this is
    // a no-op so we can iterate on the UI before wiring the pipeline.
    // eslint-disable-next-line no-console
    console.log("submit edit (no-op):", { tag, editValue });
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
      router.refresh();
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
          <div className="font-semibold">Proposal готов</div>
          <div className="mt-0.5 text-[11px] text-emerald-800/80">
            Файл <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[10px]">proposal.md</code> создан в{" "}
            <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[10px]">
              {tag}
            </code>
            . Подтвердите, чтобы перейти к следующему шагу.
          </div>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={openEditor}
            title="Запросить изменения proposal"
            aria-label="Запросить изменения proposal"
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
            htmlFor={`proposal-edit-${tag}`}
            className="block text-[11px] font-medium text-emerald-900/80"
          >
            Что изменить в proposal?
          </label>
          <textarea
            id={`proposal-edit-${tag}`}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="Например: «добавь раздел про риски», «уточни scope», «опиши как мы будем мерять успех»"
            rows={3}
            autoFocus
            className="w-full rounded-md border border-emerald-300 bg-white px-2 py-1.5 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-300"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              className="flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" />
              <span>Отмена</span>
            </button>
            <button
              type="button"
              onClick={submitEdit}
              disabled={editValue.trim().length === 0}
              className="flex h-7 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Send className="h-3.5 w-3.5" />
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