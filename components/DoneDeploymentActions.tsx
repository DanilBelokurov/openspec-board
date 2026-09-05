"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UploadCloud,
  GitPullRequest,
  RefreshCw,
  Loader2,
  Tag,
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
  sddLabelPid: number | null;
  sddLabelExitCode: number | null;
  sddLabelError: string | null;
  sddLabelLogPath: string | null;
  sddLabelAppliedAt: string | null;
  sddLabelAlive: boolean;
}

/**
 * Top-of-page deploy panel for tasks in stage "done" (mode
 * "analyst"). Renders one of four layouts based on what has
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
 *      (`pushedAt != null`, `pullRequestExitCode === 0`,
 *      `sddLabelAppliedAt == null`) →
 *      single «Обновить ветку» button + «Поставить sdd-метку»
 *      button. The Jira `sdd` label is the analyst-side
 *      handoff marker between "PR open" and "submitted for
 *      review" — once it lands on the issue, the developer
 *      stage picks the change up off the `sdd` Jira filter.
 *
 *   4. Branch published AND PR created AND `sdd` label
 *      applied (`sddLabelAppliedAt != null`) →
 *      single «Обновить ветку» button + a «sdd» badge. PR is
 *      submitted for review; further updates just push new
 *      commits to the same PR.
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
  const [labelStarting, setLabelStarting] = useState(false);
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
  const labelApplied = status?.sddLabelAppliedAt != null;

  const pushInFlight = pushing || (status?.pushAlive ?? false);
  const prInFlight = prStarting || (status?.pullRequestAlive ?? false);
  const updateInFlight = updating || (status?.pushAlive ?? false);
  const labelInFlight =
    labelStarting || (status?.sddLabelAlive ?? false);

  // Four-state layout:
  //   - branch not yet pushed                  → initial
  //   - branch pushed but PR not created       → published-no-pr
  //   - branch + PR done, sdd label missing    → published-with-pr
  //   - branch + PR done, sdd label applied    → published-with-sdd-label
  const state = !pushed
    ? "initial"
    : !prDone
      ? "published-no-pr"
      : !labelApplied
        ? "published-with-pr"
        : "published-with-sdd-label";

  // Border / colour scheme.
  //   - initial                  → sky (cool, work pending)
  //   - published-no-pr          → sky (still work pending — PR step)
  //   - published-with-pr        → sky (next pending step is the label)
  //   - published-with-sdd-label → emerald (everything done)
  const borderClass =
    state === "published-with-sdd-label"
      ? "border-emerald-200"
      : "border-sky-200";
  const bgClass =
    state === "published-with-sdd-label"
      ? "bg-emerald-50"
      : "bg-sky-50";
  const titleClass =
    state === "published-with-sdd-label"
      ? "text-emerald-900"
      : "text-sky-900";
  const hintClass =
    state === "published-with-sdd-label"
      ? "text-emerald-800/80"
      : "text-sky-800/80";
  const iconClass =
    state === "published-with-sdd-label"
      ? "text-emerald-700"
      : "text-sky-700";

  const title =
    state === "initial"
      ? "Готово к публикации"
      : state === "published-no-pr"
        ? "Ветка опубликована"
        : state === "published-with-pr"
          ? "Pull request опубликован"
          : "Передано в ревью";
  const hint =
    state === "initial"
      ? "Опубликуйте ветку в origin, затем создайте pull request через gigacode."
      : state === "published-no-pr"
        ? "Ветка в origin. Создайте pull request через gigacode — кнопка ниже."
        : state === "published-with-pr"
          ? "Pull request создан. Поставьте метку sdd на связанной Jira-задаче — разработчик подхватит её через фильтр."
          : "Метка sdd поставлена на Jira. При новых коммитах нажмите «Обновить ветку» — PR подхватит их автоматически.";

  const Icon =
    state === "published-with-sdd-label"
      ? RefreshCw
      : state === "published-with-pr"
        ? Tag
        : UploadCloud;

  return (
    <div
      className={`rounded-md border ${borderClass} ${bgClass} px-4 py-3 text-[12px] ${titleClass}`}
    >
      <div className="flex items-center gap-3">
        <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{title}</span>
            {state === "published-with-sdd-label" && (
              <span
                className="inline-flex h-5 items-center rounded-full bg-emerald-600 px-2 text-[10px] font-semibold uppercase tracking-wide text-white"
                title={`Метка sdd поставлена ${status?.sddLabelAppliedAt}`}
              >
                sdd
              </span>
            )}
          </div>
          <div className={`mt-0.5 text-[11px] ${hintClass}`}>{hint}</div>
          {(state === "published-with-pr" ||
            state === "published-with-sdd-label") &&
            status?.pullRequestUrl && (
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
        {state === "published-with-sdd-label" ? (
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
        ) : state === "published-with-pr" ? (
          <>
            <button
              type="button"
              onClick={() =>
                postJson(
                  "/update-branch",
                  null,
                  setUpdating,
                )
              }
              disabled={updateInFlight}
              title={
                updateInFlight
                  ? "Обновление уже выполняется"
                  : "git push origin <branch> — PR подхватит новые коммиты"
              }
              aria-label="Обновить ветку"
              className="flex h-8 items-center gap-1.5 rounded-md bg-sky-600 px-3 text-[12px] font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
            >
              {updating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>Обновить ветку</span>
            </button>
            <button
              type="button"
              onClick={() =>
                postJson(
                  "/apply-sdd-label",
                  { comments: "" },
                  setLabelStarting,
                )
              }
              disabled={labelInFlight}
              title={
                labelInFlight
                  ? "Постановка метки уже выполняется"
                  : "Поставить метку sdd на связанной Jira-задаче через mcp__jira-mcp__add_labels"
              }
              aria-label="Поставить sdd-метку"
              className="flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-[12px] font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
            >
              {labelStarting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Tag className="h-3.5 w-3.5" />
              )}
              <span>Поставить sdd-метку</span>
            </button>
          </>
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
