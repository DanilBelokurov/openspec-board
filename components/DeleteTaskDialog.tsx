"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2, AlertCircle, Trash2, CheckCheck } from "lucide-react";

export type DeleteAccent = "red" | "emerald";

interface DeleteTaskDialogProps {
  open: boolean;
  tag: string;
  /**
   * Visual treatment of the primary action button. "red" matches
   * the generic "Удалить" button (TaskActions), "emerald" matches
   * the "Закрыть" button on the done stage (DoneTaskActions).
   */
  accent?: DeleteAccent;
  /**
   * Primary-button label and title. "Удалить" / "Закрыть". The
   * dialog body copy follows from the same verb.
   */
  actionLabel?: string;
  /** Heading in the dialog header. Defaults to "Удалить задачу". */
  title?: string;
  /**
   * Extra body copy inserted right after the standard warning
   * paragraph. Useful for stage-specific notes ("это
   * рассматривается как завершение жизненного цикла изменения").
   */
  hint?: string;
  /**
   * Whether to render the "Также удалить ветку в origin"
   * checkbox. Defaults to true. Hide it for stages where the
   * remote branch is never created or never pushed (e.g.
   * freshly-created proposals).
   */
  showRemoteOption?: boolean;
  /**
   * Force the remote branch to be deleted without showing
   * the checkbox. When true, the request always carries
   * `?remote=1` regardless of `showRemoteOption` and the
   * user-facing checkbox is suppressed (the action is
   * non-negotiable for this stage, e.g. analyst-mode done
   * where the branch was published to origin by definition).
   */
  forceDeleteRemote?: boolean;
  /**
   * Whether the task is a child of a multi-service plan
   * (`task.parentTag` is set). When true, the dialog renders
   * the "Также удалить родительский план" checkbox. Defaults
   * to false — the parent option only makes sense for tasks
   * that actually have a parent plan to cascade into.
   */
  hasParent?: boolean;
  /**
   * Tag of the parent plan, used in the cascade-checkbox
   * subtext so the user sees the exact plan that will be
   * torn down. Optional — the dialog falls back to
   * "родительский план" when missing.
   */
  parentTag?: string;
  /** Called after a successful delete — typically router.push("/"). */
  onSuccess?: () => void;
  onClose: () => void;
}

/**
 * Two-button modal that gates the destructive POST to
 * /api/changes/<tag>/delete. Shown only after the user clicks
 * "Удалить" / "Закрыть" so the "Также удалить ветку в origin"
 * option doesn't clutter the detail page when the user has no
 * intent to delete.
 *
 * The remote-delete checkbox defaults to OFF — the safe path
 * (drop local only) stays the no-click default. Toggling it on
 * appends `?remote=1` to the URL and the server runs
 * `git push origin --delete <branch>` (with a pre-flight
 * ls-remote so a never-pushed branch is treated as a successful
 * no-op rather than an error).
 *
 * `forceDeleteRemote` flips this for stages where the remote
 * branch must always come down (analyst-mode done: by
 * definition the branch was pushed + a PR was opened, so
 * leaving it would be a leak). The checkbox is replaced by a
 * read-only confirmation block and `?remote=1` is appended
 * unconditionally.
 *
 * When `hasParent` is true (the task is a child of a multi-
 * service plan), an additional "Также удалить родительский
 * план" checkbox appears. It defaults to ON — leaving a parent
 * plan behind after deleting its child leaves the board in an
 * inconsistent state (the parent still references the gone
 * worktree), so we make the safe-and-complete path the no-click
 * default. Toggling it on appends `?cascade=1` to the URL and
 * the server also tears down every sibling (`childTags`) and
 * the parent itself in a single round-trip.
 *
 * Mirrors ReopenTaskDialog's structure (header / body / footer
 * with the same slate chrome and Escape-to-close) so the two
 * destructive modals feel like one family.
 */
export function DeleteTaskDialog({
  open,
  tag,
  accent = "red",
  actionLabel = "Удалить",
  title = "Удалить задачу",
  hint,
  showRemoteOption = true,
  forceDeleteRemote = false,
  hasParent = false,
  parentTag,
  onSuccess,
  onClose,
}: DeleteTaskDialogProps) {
  const router = useRouter();
  const [deleteRemote, setDeleteRemote] = useState(false);
  const [cascadeParent, setCascadeParent] = useState(hasParent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the dialog re-opens so the user always
  // starts from the safe defaults (no remote delete, but
  // cascade-on when a parent exists). We sync `cascadeParent`
  // with the latest `hasParent` prop so a re-render with a
  // different task doesn't keep a stale "yes" stuck on.
  useEffect(() => {
    if (!open) return;
    setDeleteRemote(false);
    setCascadeParent(hasParent);
    setError(null);
    setSubmitting(false);
  }, [open, hasParent]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  if (!open) return null;

  const accentButton =
    accent === "emerald"
      ? "bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300"
      : "bg-red-600 hover:bg-red-700 disabled:bg-red-300";
  const accentIcon =
    accent === "emerald" ? (
      <CheckCheck className="h-3.5 w-3.5" />
    ) : (
      <Trash2 className="h-3.5 w-3.5" />
    );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      // `forceDeleteRemote` overrides the checkbox state — for
      // stages where the remote branch is guaranteed to exist
      // (analyst-mode done, where the user already pushed +
      // opened a PR), the dialog omits the checkbox entirely
      // and the request always carries `?remote=1`. The local
      // checkbox state is ignored to avoid an "off" leftover
      // race if a previous render briefly set it to false.
      if (forceDeleteRemote || deleteRemote) params.set("remote", "1");
      // Only append `cascade=1` when the user explicitly asked
      // for it AND the task actually has a parent — otherwise
      // we'd be sending a useless flag the server would
      // silently ignore.
      if (cascadeParent && hasParent) params.set("cascade", "1");
      const qs = params.toString();
      const url =
        `/api/changes/${encodeURIComponent(tag)}/delete` +
        (qs ? `?${qs}` : "");
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Server wiped the worktree, dropped the local branch and
      // (optionally) pushed --delete to origin. Bounce to the
      // board — the task no longer exists in state.
      onClose();
      if (onSuccess) {
        onSuccess();
      } else {
        router.push("/");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="presentation"
      onClick={() => {
        if (!submitting) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px]"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-border bg-white shadow-cardHover"
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2
            id="delete-title"
            className="text-[14px] font-semibold text-slate-900"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Закрыть диалог"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="space-y-3 px-4 py-4 text-[12px] text-slate-700">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="font-semibold text-slate-900">
              {actionLabel} задачу{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                {tag}
              </code>
              ?
            </div>
            <div className="mt-1 text-slate-700/80">
              Будут удалены worktree, локальная ветка
              <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                feature/&lt;JIRA-ID&gt;
              </code>
              и запись в state.json. Это действие нельзя отменить.
              {hint && <div className="mt-2">{hint}</div>}
            </div>
          </div>

          {forceDeleteRemote ? (
            <div
              className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2"
              title="Удаление ветки в origin обязательно на этом этапе"
            >
              <span className="flex-1 leading-snug">
                <span className="font-medium text-emerald-900">
                  Ветка в origin также будет удалена
                </span>
                <span className="mt-0.5 block text-[11px] text-emerald-800/90">
                  Дополнительно выполнится{" "}
                  <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[10px] text-emerald-900">
                    git push origin --delete feature/&lt;JIRA-ID&gt;
                  </code>
                  . Если ветка уже отсутствует в origin, шаг
                  будет пропущен без ошибки.
                </span>
              </span>
            </div>
          ) : (
          showRemoteOption && (
            <label
              className="flex cursor-pointer select-none items-start gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 hover:bg-slate-50"
              title="Также выполнить git push origin --delete для ветки feature/<JIRA-ID>"
            >
              <input
                type="checkbox"
                checked={deleteRemote}
                onChange={(e) => setDeleteRemote(e.target.checked)}
                disabled={submitting}
                aria-label="Также удалить ветку в origin"
                className={
                  accent === "emerald"
                    ? "mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                    : "mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-red-600 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                }
              />
              <span className="flex-1 leading-snug">
                <span className="font-medium text-slate-900">
                  Также удалить ветку в origin
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-500">
                  Дополнительно выполнит{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                    git push origin --delete feature/&lt;JIRA-ID&gt;
                  </code>
                  . Если ветка ещё не отправлена, шаг будет пропущен
                  без ошибки.
                </span>
              </span>
            </label>
          ))}

          {hasParent && (
            <label
              className="flex cursor-pointer select-none items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 hover:bg-amber-100"
              title="Каскадное удаление: вместе с этой задачей будут удалены родительский план и все дочерние сервисы"
            >
              <input
                type="checkbox"
                checked={cascadeParent}
                onChange={(e) => setCascadeParent(e.target.checked)}
                disabled={submitting}
                aria-label="Также удалить родительский план"
                className={
                  accent === "emerald"
                    ? "mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-amber-400 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                    : "mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-amber-400 text-amber-600 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                }
              />
              <span className="flex-1 leading-snug">
                <span className="font-medium text-amber-900">
                  Также удалить родительский план
                  {parentTag && (
                    <>
                      {" "}
                      <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] text-amber-800">
                        {parentTag}
                      </code>
                    </>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] text-amber-800/90">
                  Вместе с этой задачей будут удалены родительский план и
                  все связанные дочерние сервисы (включая их worktree и
                  ветки). Иначе на доске останется «висячий» план со
                  ссылкой на удалённый worktree.
                </span>
              </span>
            </label>
          )}

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
            disabled={submitting}
            className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium text-white disabled:cursor-not-allowed ${accentButton}`}
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              accentIcon
            )}
            <span>{actionLabel}</span>
          </button>
        </footer>
      </form>
    </div>
  );
}
