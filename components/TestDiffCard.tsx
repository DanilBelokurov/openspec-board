"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Check, Loader2 } from "lucide-react";

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

/**
 * Renders after RED has finished (redPhaseExitCode === 0)
 * and the dev hasn't approved yet — or after a previous
 * "Подтвердить" click failed at the commit step and is now
 * retryable. Fetches the cumulative test diff from
 * `/api/changes/<tag>/test-diff` and shows it inline via
 * react-diff-viewer-continued. The "Подтвердить" button
 * calls /implement/approve which stamps redPhaseApprovedAt,
 * commits the RED tests, and spawns the GREEN phase.
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
              : "Проверьте diff ниже. Нажмите «Подтвердить», чтобы закоммитить тесты и запустить GREEN-фазу (написание бизнес-логики)."}
          </div>
        </div>
        <button
          type="button"
          onClick={handleApprove}
          disabled={approving}
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

      {retry && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          <span className="font-semibold">Коммит тестов упал:</span>{" "}
          {commitError}
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
