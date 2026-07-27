"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Check, Loader2, Pencil, Send, X } from "lucide-react";

interface TestDiffCardProps {
  /** Child task tag. Used for the API calls. */
  tag: string;
  /**
   * If set, the user previously clicked "Подтвердить" but the
   * subsequent `git commit` of the RED tests failed. The card
   * re-renders with the failure banner above the diff and the
   * button label flips to "Повторить коммит" so the user knows
   * a re-approve will retry the commit, not re-review the tests.
   */
  commitError?: string | null;
}

const COMMENTS_MAX_LENGTH = 5000;

/**
 * Renders after RED has finished (redPhaseExitCode === 0)
 * and the dev hasn't approved yet — or after a previous
 * "Подтвердить" click failed at the commit step and is now
 * retryable. Fetches the cumulative test diff from
 * `/api/changes/<tag>/test-diff` and shows it inline via
 * react-diff-viewer-continued.
 *
 * Two actions on the card:
 *  - "Подтвердить" / "Повторить коммит" calls
 *    /implement/approve which stamps redPhaseApprovedAt,
 *    commits the RED tests, and spawns the GREEN phase.
 *  - Pencil → inline textarea → "Отправить" calls
 *    /implement/update-red which spawns a RED UPDATE:
 *    re-run RED with the user's comment, asking the agent
 *    to rewrite the tests. Mirrors the `ConfirmArtifactButton`
 *    pattern from the analyst stages.
 *
 * The diff is fetched client-side from the API endpoint
 * (server-side `git diff`) — react-diff-viewer-continued
 * is a client component and doesn't have access to the
 * server's filesystem, so the test-text has to cross the
 * wire. The endpoint returns plain text (git diff's
 * default output) which the diff viewer parses.
 */
export function TestDiffCard({ tag, commitError }: TestDiffCardProps) {
  const router = useRouter();
  const [diff, setDiff] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/changes/${encodeURIComponent(tag)}/test-diff`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!cancelled) {
            setLoadError(data.error ?? `HTTP ${res.status}`);
          }
          return;
        }
        const text = await res.text();
        if (!cancelled) setDiff(text);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tag]);

  async function handleApprove() {
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/implement/approve`,
        { method: "POST" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setApproveError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // GREEN has been spawned — the page re-fetches and the
      // diff card hides (replaced by the GREEN process card).
      router.refresh();
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : String(e));
    } finally {
      setApproving(false);
    }
  }

  function openEditor() {
    setEditing(true);
    setEditValue("");
    setUpdateError(null);
  }

  function cancelEdit() {
    setEditing(false);
    setEditValue("");
    setUpdateError(null);
  }

  async function submitEdit() {
    const trimmed = editValue.trim();
    if (trimmed.length < 3) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/implement/update-red`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comments: trimmed }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setUpdateError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Collapse the editor; the update gigacode runs in the
      // background and rewrites the test files in the worktree.
      // The page hides the diff card while the update is alive
      // (so the diff doesn't show in-progress edits) and shows
      // the "Обновление RED-фазы" process card.
      setEditing(false);
      setEditValue("");
      router.refresh();
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdating(false);
    }
  }

  const retry = commitError != null;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
      <div className="flex items-center gap-3">
        <Check className="h-4 w-4 shrink-0 text-amber-700" />
        <div className="flex-1">
          <div className="font-semibold">
            {retry
              ? "Тесты RED-фазы ожидают коммита"
              : "Тесты RED-фазы написаны"}
          </div>
          <div className="mt-0.5 text-[11px] text-amber-800/80">
            {retry
              ? "Предыдущая попытка коммита упала. Проверьте diff ниже — нажмите «Повторить коммит», чтобы перезапустить `git commit` и затем GREEN-фазу."
              : "Проверьте diff ниже. Нажмите «Подтвердить», чтобы закоммитить тесты и запустить GREEN-фазу. Если тесты нужно переделать — воспользуйтесь карандашом."}
          </div>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={openEditor}
            title="Переделать тесты с учётом комментария"
            aria-label="Переделать тесты с учётом комментария"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-amber-300 bg-white text-amber-700 hover:bg-amber-100"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={handleApprove}
          disabled={approving || editing}
          className="flex h-8 items-center gap-1.5 rounded-md bg-amber-600 px-3 text-[12px] font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {approving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          <span>{retry ? "Повторить коммит" : "Подтвердить"}</span>
        </button>
      </div>

      {editing && (
        <div className="mt-3 space-y-2 border-t border-amber-200/70 pt-3">
          <label
            htmlFor={`red-update-red-${tag}`}
            className="block text-[11px] font-medium text-amber-900/80"
          >
            Что переделать в тестах?
          </label>
          <textarea
            id={`red-update-red-${tag}`}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="Например: «добавь тест на ошибку авторизации», «упрости setup фикстур», «убери избыточные test.each параметры»"
            rows={3}
            maxLength={COMMENTS_MAX_LENGTH}
            autoFocus
            disabled={updating}
            className="w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-300 disabled:bg-slate-50"
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
              disabled={updating || editValue.trim().length < 3}
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

      {retry && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          <span className="font-semibold">Коммит тестов упал:</span>{" "}
          {commitError}
        </div>
      )}

      {updateError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {updateError}
        </div>
      )}

      {approveError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {approveError}
        </div>
      )}

      <div className="mt-3 border-t border-amber-200/70 pt-3">
        {loadError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
            Не удалось загрузить diff: {loadError}
          </div>
        ) : diff === null ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-amber-800/80">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Загружаем diff тестов…</span>
          </div>
        ) : diff.trim() === "" ? (
          retry ? (
            <div className="rounded-md border border-amber-300 bg-amber-100 px-2.5 py-1.5 text-[11px] text-amber-900">
              После неудачного коммита рабочая копия чистая — RED, видимо, откатил свои файлы. Проверьте лог <code className="rounded bg-amber-200 px-1 py-0.5 font-mono text-[10px]">{tag}.develop.red.log</code> и перезапустите RED.
            </div>
          ) : (
            <div className="rounded-md border border-amber-300 bg-amber-100 px-2.5 py-1.5 text-[11px] text-amber-900">
              RED не оставил тестов. Проверьте лог <code className="rounded bg-amber-200 px-1 py-0.5 font-mono text-[10px]">{tag}.develop.red.log</code> — RED, вероятно, упал до write.
            </div>
          )
        ) : (
          <div
            data-testid="test-diff-viewer"
            className="rounded-md border border-amber-200/60 bg-white [&_*]:font-mono [&_*]:text-[11px]"
          >
            <ReactDiffViewer
              oldValue=""
              newValue={diff}
              splitView
              useDarkTheme={false}
              compareMethod={DiffMethod.LINES}
              leftTitle="До RED-фазы"
              rightTitle="После RED-фазы"
            />
          </div>
        )}
      </div>
    </div>
  );
}
