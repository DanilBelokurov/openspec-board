"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Send, X, ArrowUp } from "lucide-react";

interface ReviewReadyCardProps {
  /** Child task tag (service name). Used for the API calls. */
  tag: string;
  /** Short SHA of the auto-commit of RED's tests. */
  commitSha?: string | null;
  /** Full commit message (the auto-commit ran with the
   *  standard `test: RED-phase tests for <service>` line). */
  commitMessage?: string | null;
  /** Stderr from the failed auto-commit, if any. */
  commitError?: string | null;
  /** Branch name (`feature/<JIRA-ID>`). */
  pushBranch?: string | null;
  /**
   * Full clickable https URL pointing at the branch on the forge's
   * web UI, e.g. `https://sc-ci.sber.ru/sc/UKPO/ukpo/src/branch/feature/OKECS-13080`
   * for Bitbucket DC Sber or `https://github.com/user/repo/tree/feature/x`
   * for GitHub. Built by `buildBranchUrl` in `lib/branch-url.ts`
   * from the raw `git config remote.origin.url` immediately after
   * the push succeeds. The card renders this as a clickable link.
   */
  pushRemoteUrl?: string | null;
  /** ISO timestamp of the successful push. */
  pushedAt?: string | null;
  /** Stderr from the failed push, if any. */
  pushError?: string | null;
}

/**
 * Shown after RED has exited 0 and the auto-commit + push
 * has run (or failed). The dev sees the commit info, a link
 * to the branch on GitHub, and either the "Подтвердить"
 * button (when push succeeded) or a retry path
 * (commit/push failed). The pencil button is preserved
 * from the old TestDiffCard-era flow — clicking it opens
 * an inline textarea that POSTs to
 * `/implement/update-red` to spawn a RED UPDATE with the
 * user's comment.
 *
 * The diff view itself is out of scope of the board — the
 * dev reviews on GitHub. The card carries only the metadata
 * needed to point them at the branch and tell them whether
 * they're allowed to approve.
 */
export function ReviewReadyCard({
  tag,
  commitSha,
  commitMessage,
  commitError,
  pushBranch,
  pushRemoteUrl,
  pushedAt,
  pushError,
}: ReviewReadyCardProps) {
  const router = useRouter();
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushRetryError, setPushRetryError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // The button is enabled only when the agreed 2B contract
  // is satisfied: the commit SHA is set (RED wrote tests)
  // AND there's no push error AND push actually completed.
  // Note: a missing redPhasePushedAt means the commit
  // succeeded but the push never ran (e.g. the exit handler
  // crashed mid-flight) — also blocks.
  const ready =
    !!commitSha && !commitError && !pushError && !!pushedAt;

  async function handleApprove() {
    if (!ready) return;
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
      // GREEN has been spawned — the page re-fetches and
      // this card hides (replaced by the GREEN process card).
      router.refresh();
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : String(e));
    } finally {
      setApproving(false);
    }
  }

  async function handlePush() {
    setPushing(true);
    setPushRetryError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/implement/push`,
        { method: "POST" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setPushRetryError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Push succeeded — re-fetch so the new state lands
      // (the card's `pushError` flips to null and
      // "Подтвердить" becomes enabled).
      router.refresh();
    } catch (e) {
      setPushRetryError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
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
      setEditing(false);
      setEditValue("");
      router.refresh();
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdating(false);
    }
  }

  // Build the branch URL on GitHub / GitLab / Bitbucket.
  // `pushRemoteUrl` is now the full branch URL produced by
  // `buildBranchUrl` (lib/branch-url.ts), so we just use it
  // verbatim. `pushBranch` is kept as a prop purely for the
  // "Ветка: <code>feature/x</code>" label below — it is no
  // longer needed for link construction.
  const branchUrl = pushRemoteUrl ?? null;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
      <div className="flex items-center gap-3">
        <Check className="h-4 w-4 shrink-0 text-amber-700" />
        <div className="flex-1">
          <div className="font-semibold">
            {pushError
              ? "Push ветки упал — повторите перед проверкой"
              : commitError
                ? "Auto-коммит RED-тестов упал"
                : pushedAt
                  ? "RED-фаза · тесты готовы к проверке"
                  : "Готовим тесты к проверке…"}
          </div>
          <div className="mt-0.5 text-[11px] text-amber-800/80">
            {ready
              ? "Закоммичены и отправлены в remote. Откройте ветку на GitHub, посмотрите дифф, потом нажмите «Подтвердить»."
              : pushError
                ? "Push завершился с ошибкой. Нажмите «Push», чтобы повторить, потом «Подтвердить»."
                : commitError
                  ? "Коммит упал — перезапустите RED (кнопка «Перезапустить» на карточке выше)."
                  : "Подождите, идёт коммит + push."}
          </div>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={openEditor}
            title="Переделать тесты с учётом комментария"
            aria-label="Переделать тесты с учётом комментария"
            disabled={!commitSha}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-amber-300 bg-white text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={handleApprove}
          disabled={!ready || approving || editing}
          className="flex h-8 items-center gap-1.5 rounded-md bg-amber-600 px-3 text-[12px] font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          title={
            ready
              ? "Подтвердить RED-тесты и запустить GREEN"
              : "Сначала закоммитьте и запушьте ветку"
          }
        >
          {approving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          <span>Подтвердить</span>
        </button>
      </div>

      {editing && (
        <div className="mt-3 space-y-2 border-t border-amber-200/70 pt-3">
          <label
            htmlFor={`red-update-${tag}`}
            className="block text-[11px] font-medium text-amber-900/80"
          >
            Что переделать в тестах?
          </label>
          <textarea
            id={`red-update-${tag}`}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="Например: «добавь тест на ошибку авторизации», «упрости setup фикстур», «убери избыточные test.each параметры»"
            rows={3}
            maxLength={5000}
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

      {commitError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          <span className="font-semibold">Auto-коммит упал:</span>{" "}
          {commitError}
        </div>
      )}

      {pushError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          <div>
            <span className="font-semibold">Push упал:</span> {pushError}
          </div>
          <div className="mt-2">
            <button
              type="button"
              onClick={handlePush}
              disabled={pushing}
              className="flex h-7 items-center gap-1.5 rounded-md bg-red-600 px-3 text-[11px] font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {pushing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowUp className="h-3 w-3" />
              )}
              <span>Push</span>
            </button>
          </div>
          {pushRetryError && (
            <div className="mt-2 text-[10px]">{pushRetryError}</div>
          )}
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
        {!commitSha && !commitError ? (
          <div className="text-[11px] text-amber-800/80">
            RED не оставил тестов. Проверьте лог{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">
              {tag}.develop.red.log
            </code>{" "}
            и перезапустите RED.
          </div>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            {commitSha && (
              <>
                <dt className="text-amber-800/70">Коммит</dt>
                <dd className="font-mono text-[10px] text-slate-700">
                  <span className="rounded bg-amber-100 px-1 py-0.5">
                    {commitSha.slice(0, 7)}
                  </span>{" "}
                  <span className="text-slate-600">
                    {commitMessage ??
                      `test: RED-phase tests for ${tag}`}
                  </span>
                </dd>
              </>
            )}
            {pushBranch && (
              <>
                <dt className="text-amber-800/70">Ветка</dt>
                <dd className="text-slate-700">
                  <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">
                    {pushBranch}
                  </code>
                  {branchUrl && (
                    <>
                      {" "}
                      <a
                        href={branchUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 underline"
                      >
                        Открыть ветку →
                      </a>
                    </>
                  )}
                </dd>
              </>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}
