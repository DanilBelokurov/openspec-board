"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2, AlertCircle } from "lucide-react";
import type { Stage } from "@/lib/openspec";

interface ReopenTaskDialogProps {
  open: boolean;
  tag: string;
  /** Stage the task is currently on — dialog only offers targets
   *  strictly earlier than this. */
  fromStage: Stage;
  onClose: () => void;
}

const STAGE_OPTIONS: Array<{ value: Stage; label: string }> = [
  { value: "proposal", label: "Proposal" },
  { value: "delta-spec", label: "Дельта-спецификация" },
  { value: "design", label: "Дизайн" },
  { value: "adr", label: "ADR" },
];

const ANALYST_STAGE_ORDER: Stage[] = [
  "proposal",
  "delta-spec",
  "design",
  "adr",
  "done",
];

function stageIndex(stage: Stage): number {
  return ANALYST_STAGE_ORDER.indexOf(stage);
}

/** Stage labels (Russian UI chrome). */
const STAGE_LABEL: Record<Stage, string> = {
  backlog: "Бэклог",
  decomposition: "Декомпозиция",
  plan: "План",
  develop: "Разработка",
  deploy: "Деплой",
  done: "Готово",
  proposal: "Proposal",
  "delta-spec": "Дельта-спецификация",
  design: "Дизайн",
  adr: "ADR",
};

export function ReopenTaskDialog({
  open,
  tag,
  fromStage,
  onClose,
}: ReopenTaskDialogProps) {
  const router = useRouter();

  // Only allow targets strictly earlier than the current stage.
  // From proposal the list is empty — the caller should hide the
  // dialog trigger in that case, but defend here too.
  const availableTargets = STAGE_OPTIONS.filter(
    (opt) => stageIndex(opt.value) < stageIndex(fromStage),
  );

  // Sensible default: the latest stage still available.
  const defaultTarget =
    availableTargets.length > 0
      ? availableTargets[availableTargets.length - 1].value
      : "proposal";

  const [stage, setStage] = useState<Stage>(defaultTarget);
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStage(defaultTarget);
    setComments("");
    setError(null);
    // Intentionally only on `open` — the target list is
    // recomputed from props on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // If there are no available targets (e.g. from proposal) we
  // render a minimal "no-op" dialog so callers don't have to
  // special-case the empty state.
  if (availableTargets.length === 0) {
    return (
      <div
        role="presentation"
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px]"
      >
        <div
          role="dialog"
          aria-modal="true"
          className="w-full max-w-md rounded-lg border border-border bg-white shadow-cardHover"
        >
          <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <h2 className="text-[14px] font-semibold text-slate-900">
              Редактировать задачу
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть диалог"
              className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </header>
          <div className="space-y-3 px-4 py-4 text-[12px] text-slate-700">
            На этапе «{STAGE_LABEL[fromStage]}» откатываться
            некуда.
          </div>
          <footer className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="h-7 rounded-md border border-border bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
            >
              Закрыть
            </button>
          </footer>
        </div>
      </div>
    );
  }

  // Cascade scope preview: from target T up to (and including)
  // the stage the user is on. The user can see which stages
  // will be re-written before they confirm.
  const stagesInCascade = ANALYST_STAGE_ORDER.filter(
    (s) => stageIndex(s) >= stageIndex(stage) && stageIndex(s) <= stageIndex(fromStage),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (comments.trim().length === 0) {
      setError("Опишите, что нужно изменить и почему");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/reopen`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetStage: stage, comments }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Stay on the detail page so the user can watch the cascade
      // unfold (the watcher will surface the new update PID in
      // the "Обновление …" card on the next render).
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px]"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="reopen-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-border bg-white shadow-cardHover"
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2
            id="reopen-title"
            className="text-[14px] font-semibold text-slate-900"
          >
            Редактировать задачу
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть диалог"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="space-y-3 px-4 py-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            <div className="font-semibold">
              Задача <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">{tag}</code>{" "}
              сейчас в стадии «{STAGE_LABEL[fromStage]}».
            </div>
            <div className="mt-1 text-amber-800/80">
              Задача вернётся на выбранный этап, и gigacode
              перепишет артефакт этого этапа с учётом вашего
              комментария. После каждого подтверждения артефакт
              следующего этапа будет переписан автоматически — пока
              задача не дойдёт до «{STAGE_LABEL[fromStage]}».
              {fromStage !== "done" && (
                <>
                  {" "}Артефакты этапов, идущих строго после «
                  {STAGE_LABEL[fromStage]}», будут помечены как
                  устаревшие — их можно обновить вручную карандашом
                  или подтвердить как есть.
                </>
              )}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-slate-800">
              Вернуться на этап
            </span>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as Stage)}
              className="h-8 rounded-md border border-border bg-white px-2 text-[12px] text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
            >
              {availableTargets.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-500">
              Каскадно будут обновлены:{" "}
              {stagesInCascade.map((s) => STAGE_LABEL[s]).join(" → ")}
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-slate-800">
              Что нужно изменить и почему
            </span>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Например: «ADR-001 недостаточно обоснован — добавь сравнение альтернатив, особенно отказ от HSM-обёртки в пользу прямого openssl»"
              rows={5}
              autoFocus
              className="rounded-md border border-border bg-white px-2 py-1.5 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            <span className="text-[11px] text-slate-500">
              Этот текст будет передан gigacode как комментарий к
              переписыванию артефакта на каждом этапе каскада.
            </span>
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-7 rounded-md border border-border bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={submitting || comments.trim().length === 0}
            className="flex h-7 items-center gap-1.5 rounded-md bg-amber-600 px-3 text-[12px] font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
          >
            {submitting && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            <span>Запустить</span>
          </button>
        </footer>
      </form>
    </div>
  );
}