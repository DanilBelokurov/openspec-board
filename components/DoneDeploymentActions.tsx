"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UploadCloud,
  GitPullRequest,
  RefreshCw,
  Loader2,
} from "lucide-react";

interface DoneDeploymentActionsProps {
  tag: string;
}

interface DeployStatus {
  pushedAt: string | null;
  pushPid: number | null;
  pushExitCode: number | null;
  pushError: string | null;
  pushLogPath: string | null;
  pushRemoteUrl: string | null;
  pushAlive: boolean;
  pullRequestPid: number | null;
  pullRequestExitCode: number | null;
  pullRequestError: string | null;
  pullRequestLogPath: string | null;
  pullRequestUrl: string | null;
  pullRequestAlive: boolean;
}

/**
 * Top-of-page deploy panel for tasks in stage "done" (mode
 * "analyst"). Renders one of three layouts based on what has
 * already happened on this branch:
 *
 *   1. Branch never published (`pushedAt == null`) →
 *      «Опубликовать ветку» + disabled «Сделать pull request».
 *
 *   2. Branch published but PR not yet created or failed
 *      (`pushedAt != null`, `pullRequestExitCode !== 0`) →
 *      disabled «Опубликовать ветку» + enabled
 *      «Сделать pull request». Mirrors state 1 from the user's
 *      perspective but acknowledges the push is done.
 *
 *   3. Branch published AND PR created
 *      (`pushedAt != null`, `pullRequestExitCode === 0`) →
 *      single «Обновить ветку» button. Reached either by the
 *      natural initial-publish → create-PR happy path or by
 *      reopening the task and re-confirming through
 *      design/adr to done (the local branch now has new commits
 *      that the existing PR should pick up via branch tracking).
 *
 * `pushDisabled` keeps the publish button one-shot per the
 * existing semantic — a second `-u origin` push would either be
 * a no-op or hit upstream policy. Use «Обновить ветку» instead.
 */
export function DoneDeploymentActions({ tag }: DoneDeploymentActionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [pushing, setPushing] = useState(false);
  const [prStarting, setPrStarting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(
          `/api/changes/${encodeURIComponent(tag)}/deploy-status`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as DeployStatus;
        if (!cancelled) setStatus(data);
      } catch {
        /* ignore — next tick will retry */
      }
    }
    void poll();
    const handle = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [tag]);

  async function postJson(
    path: string,
    body: unknown | null,
    busySetter: (v: boolean) => void,
  ) {
    busySetter(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}${path}`,
        {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(
          (data as { error?: string }).error ?? `HTTP ${res.status}`,
        );
        return;
      }
      router.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      busySetter(false);
    }
  }

  const pushed = status?.pushedAt != null;
  const prDone =
    status?.pullRequestExitCode != null &&
    status?.pullRequestExitCode === 0;

  const pushInFlight = pushing || (status?.pushAlive ?? false);
  const prInFlight = prStarting || (status?.pullRequestAlive ?? false);
  const updateInFlight = updating || (status?.pushAlive ?? false);

  // Three-state layout:
  //   - branch not yet pushed             → two buttons (publish + PR)
  //   - branch pushed but PR not created  → two buttons (publish disabled + PR)
  //   - branch pushed and PR created      → single «Обновить ветку» button
  const state = !pushed
    ? "initial"
    : prDone
      ? "published-with-pr"
      : "published-no-pr";

  // Border / colour scheme.
  //   - initial                  → sky (cool, work pending)
  //   - published-no-pr          → sky (still work pending — PR step)
  //   - published-with-pr        → emerald (everything done; updates are an emerald accent)
  const borderClass =
    state === "published-with-pr"
      ? "border-emerald-200"
      : "border-sky-200";
  const bgClass =
    state === "published-with-pr" ? "bg-emerald-50" : "bg-sky-50";
  const titleClass =
    state === "published-with-pr"
      ? "text-emerald-900"
      : "text-sky-900";
  const hintClass =
    state === "published-with-pr"
      ? "text-emerald-800/80"
      : "text-sky-800/80";
  const iconClass =
    state === "published-with-pr"
      ? "text-emerald-700"
      : "text-sky-700";

  const title =
    state === "initial"
      ? "Готово к публикации"
      : state === "published-no-pr"
        ? "Ветка опубликована"
        : "Опубликовано";
  const hint =
    state === "initial"
      ? "Опубликуйте ветку в origin, затем создайте pull request через gigacode."
      : state === "published-no-pr"
        ? "Ветка в origin. Создайте pull request через gigacode — кнопка ниже."
        : status?.pullRequestUrl
          ? "Ветка и pull request опубликованы. При новых коммитах нажмите «Обновить ветку» — PR подхватит их автоматически."
          : "Ветка и pull request опубликованы. При новых коммитах нажмите «Обновить ветку» — PR подхватит их автоматически.";

  const Icon =
    state === "published-with-pr" ? RefreshCw : UploadCloud;

  return (
    <div
      className={`rounded-md border ${borderClass} ${bgClass} px-4 py-3 text-[12px] ${titleClass}`}
    >
      <div className="flex items-center gap-3">
        <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} />
        <div className="flex-1">
          <div className="font-semibold">{title}</div>
          <div className={`mt-0.5 text-[11px] ${hintClass}`}>{hint}</div>
          {state === "published-with-pr" && status?.pullRequestUrl && (
            <div className={`mt-0.5 text-[11px] ${hintClass}`}>
              PR:{" "}
              <a
                href={status.pullRequestUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 underline break-all"
              >
                {status.pullRequestUrl}
              </a>
            </div>
          )}
        </div>
        {state === "published-with-pr" ? (
          <button
            type="button"
            onClick={() =>
              postJson("/update-branch", null, setUpdating)
            }
            disabled={updateInFlight}
            title={
              updateInFlight
                ? "Обновление уже выполняется"
                : "git push origin <branch> — PR подхватит новые коммиты"
            }
            aria-label="Обновить ветку"
            className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            {updating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>Обновить ветку</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => postJson("/push", null, setPushing)}
              disabled={pushed || pushInFlight}
              title={
                pushed
                  ? "Ветка уже опубликована"
                  : "Опубликовать ветку в origin"
              }
              aria-label="Опубликовать ветку"
              className="flex h-8 items-center gap-1.5 rounded-md bg-sky-600 px-3 text-[12px] font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
            >
              {pushing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UploadCloud className="h-3.5 w-3.5" />
              )}
              <span>Опубликовать ветку</span>
            </button>
            <button
              type="button"
              onClick={() =>
                postJson(
                  "/create-pull-request",
                  { comments: "" },
                  setPrStarting,
                )
              }
              disabled={!pushed || prInFlight}
              title={
                !pushed
                  ? "Сначала опубликуйте ветку"
                  : "Создать pull request через gigacode"
              }
              aria-label="Сделать pull request"
              className="flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-[12px] font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
            >
              {prStarting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitPullRequest className="h-3.5 w-3.5" />
              )}
              <span>Сделать pull request</span>
            </button>
          </>
        )}
      </div>
      {actionError && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {actionError}
        </div>
      )}
    </div>
  );
}
