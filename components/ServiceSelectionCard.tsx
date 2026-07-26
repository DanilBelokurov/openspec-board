"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Play, Loader2, X, Send } from "lucide-react";

export interface ServiceSelectionCardRepo {
  /** Repo key from config.repos. */
  name: string;
  /** Local path the dev-mode TDD pipeline will use as the
   *  worktree's parent. Surfaced as a tooltip on the option
   *  so the dev sees which checkout they're targeting. */
  localPath: string;
}

interface ServiceSelectionCardProps {
  /** Parent change tag. The card POSTs to
   *  `/api/changes/<tag>/confirm` with the selection. */
  tag: string;
  /** Service names discovered under
   *  `<change>/tasks/` that don't yet have a child task. */
  services: string[];
  /** Available code repos, surfaced in the dropdown. */
  repos: ServiceSelectionCardRepo[];
  /** Optional pre-fill (e.g. last session's selection). */
  initialSelection?: Record<string, string>;
}

/**
 * Service-selection card shown on the plan-stage detail page
 * when the change-proposal has per-service `tasks/<service>/`
 * subdirectories. The dev picks a code repo for each service
 * (or leaves the row as "не запускать"). The
 * `Подтверждаю` button is enabled when at least one service
 * has a real repo chosen.
 *
 * On submit, POSTs `{ services: Record<service, repoName> }`
 * to `/api/changes/<tag>/confirm`. Services the dev left as
 * "skip" are omitted from the payload (the endpoint will
 * treat absent services as "no child created"). On 2xx the
 * page re-fetches so the new child tasks render.
 *
 * Replaces the standard `ConfirmArtifactButton` on the plan
 * stage in the multi-service case. The single-service case
 * (no `tasks/<service>/` subdirs) keeps using the old button.
 */
export function ServiceSelectionCard({
  tag,
  services,
  repos,
  initialSelection,
}: ServiceSelectionCardProps) {
  const router = useRouter();
  const [selection, setSelection] = useState<Record<string, string>>(
    () => {
      const init: Record<string, string> = {};
      for (const s of services) {
        init[s] = initialSelection?.[s] ?? "skip";
      }
      return init;
    },
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pencil / inline-editor state for the "re-run plan with
  // a free-form request" flow. Mirrors the design/adr
  // pattern in ConfirmArtifactButton: clicking the pencil
  // opens a textarea; submitting POSTs to
  // /api/changes/<tag>/update-plan.
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [updateSubmitting, setUpdateSubmitting] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => services.some((s) => selection[s] && selection[s] !== "skip"),
    [services, selection],
  );

  function openEditor() {
    setEditing(true);
    setEditValue("");
    setUpdateError(null);
  }
  function cancelEdit() {
    setEditing(false);
    setEditValue("");
  }

  async function submitEdit() {
    const comments = editValue.trim();
    if (!comments) return;
    setUpdateSubmitting(true);
    setUpdateError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/update-plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comments }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setUpdateError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // 202 Accepted — the gigacode re-run is detached. The
      // page re-fetches so the new planCreatePid process
      // card appears. The user's existing selection
      // (parent.serviceRepos) is preserved across the re-run,
      // so the dropdowns stay pre-filled.
      setEditing(false);
      setEditValue("");
      router.refresh();
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdateSubmitting(false);
    }
  }

  async function handleSubmit() {
    const payload: Record<string, string> = {};
    for (const [service, repo] of Object.entries(selection)) {
      if (repo && repo !== "skip") payload[service] = repo;
    }
    if (Object.keys(payload).length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ services: payload }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // /confirm creates child tasks (one per service) in
      // develop stage, commits tasks.md, and persists the
      // service→repo mapping on the parent. After 2xx we
      // re-fetch so the new child cards render and the parent
      // stays in plan (still has un-started services) or
      // disappears from the board (all services started).
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (services.length === 0) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
        Подпапок в <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">tasks/</code> не найдено — план-пайплайн ещё не отработал или change-proposal однопоточный (tasks.md в корне change-папки).
      </div>
    );
  }

  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-900">
      <div className="flex items-center gap-3">
        <Play className="h-4 w-4 shrink-0 fill-emerald-700 text-emerald-700" />
        <div className="flex-1">
          <div className="font-semibold">Запустить разработку</div>
          <div className="mt-0.5 text-[11px] text-emerald-800/80">
            Выберите репозиторий для каждого сервиса из{" "}
            <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[10px]">tasks/</code>
            . Сервисы со статусом «Не запускать» останутся в этом списке до следующего захода.
          </div>
        </div>
        <button
          type="button"
          onClick={openEditor}
          title="Запросить изменения"
          aria-label="Запросить изменения"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-white" />
          )}
          <span>Подтверждаю</span>
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {error}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-2 border-t border-emerald-200/70 pt-3">
          <label
            htmlFor={`plan-edit-${tag}`}
            className="block text-[11px] font-medium text-emerald-900/80"
          >
            Что изменить в плане?
          </label>
          <textarea
            id={`plan-edit-${tag}`}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={
              "Например: «добавь секцию про тесты для edge cases», «разбей task 3 на подзадачи», «учти multi-region failover»"
            }
            rows={3}
            autoFocus
            disabled={updateSubmitting}
            className="w-full rounded-md border border-emerald-300 bg-white px-2 py-1.5 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-300 disabled:bg-slate-50"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={updateSubmitting}
              className="flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              <span>Отмена</span>
            </button>
            <button
              type="button"
              onClick={submitEdit}
              disabled={updateSubmitting || editValue.trim().length === 0}
              className="flex h-7 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {updateSubmitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>Отправить</span>
            </button>
          </div>
          {updateError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
              {updateError}
            </div>
          )}
        </div>
      )}

      {!editing && (
        <div className="mt-3 space-y-2 border-t border-emerald-200/70 pt-3">
        {services.map((service) => (
          <label
            key={service}
            className="flex items-center gap-3 rounded-md border border-emerald-200/60 bg-white/70 px-3 py-2"
          >
            <span className="w-44 shrink-0 font-mono text-[12px] text-slate-800">
              {service}
            </span>
            <span className="text-slate-400">→</span>
            <select
              value={selection[service] ?? "skip"}
              onChange={(e) =>
                setSelection((prev) => ({
                  ...prev,
                  [service]: e.target.value,
                }))
              }
              disabled={submitting}
              className="h-8 flex-1 rounded-md border border-border bg-white px-2 text-[12px] text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300 disabled:bg-slate-50"
            >
              <option value="skip">Не запускать разработку</option>
              {repos.map((r) => (
                <option key={r.name} value={r.name} title={r.localPath}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      )}
    </div>
  );
}
