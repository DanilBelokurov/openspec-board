"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, GitPullRequest, Loader2 } from "lucide-react";

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
 * "analyst"). Same chrome as ConfirmArtifactButton: an emerald
 * border on the active variant, sky / indigo when the work
 * hasn't run yet, and a green border when both sub-steps are
 * done. Two buttons:
 *
 *   - "Опубликовать ветку" → POST /api/changes/<tag>/push, which
 *     spawns `git push -u origin <branch>` detached. One-shot: the
 *     button becomes disabled once `pushedAt` is set, even if
 *     the user reloads the page.
 *
 *   - "Сделать pull request" → POST /api/changes/<tag>/create-pull-request.
 *     The endpoint refuses to run unless `pushedAt` is set. We
 *     also gate the button client-side to give the same message
 *     before the request leaves the browser.
 */
export function DoneDeploymentActions({ tag }: DoneDeploymentActionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [pushing, setPushing] = useState(false);
  const [prStarting, setPrStarting] = useState(false);
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

  async function handlePush() {
    setPushing(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/push`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
    }
  }

  async function handleCreatePr() {
    setPrStarting(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/create-pull-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comments: "" }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setPrStarting(false);
    }
  }

  const pushed = status?.pushedAt != null;
  const pushInFlight = pushing || (status?.pushAlive ?? false);
  const prInFlight =
    prStarting || (status?.pullRequestAlive ?? false);
  const prDone =
    status?.pullRequestExitCode != null &&
    status?.pullRequestExitCode === 0;

  // The push button is one-shot: once the branch is up on the
  // remote, pushing again would either be a no-op or a server
  // policy error. Keep it disabled to make the lifecycle obvious
  // in the UI.
  const pushDisabled = pushed || pushInFlight;
  const prDisabled = !pushed || prInFlight;

  // Border colour follows the same logic as
  // ConfirmArtifactButton — green when the deploy is done, sky
  // while work is in flight / not started.
  const borderClass = prDone
    ? "border-emerald-200"
    : "border-sky-200";
  const bgClass = prDone ? "bg-emerald-50" : "bg-sky-50";
  const titleClass = prDone ? "text-emerald-900" : "text-sky-900";
  const hintClass = prDone
    ? "text-emerald-800/80"
    : "text-sky-800/80";
  const iconClass = prDone
    ? "text-emerald-700"
    : "text-sky-700";

  return (
    <div
      className={`rounded-md border ${borderClass} ${bgClass} px-4 py-3 text-[12px] ${titleClass}`}
    >
      <div className="flex items-center gap-3">
        <UploadCloud
          className={`h-4 w-4 shrink-0 ${iconClass}`}
        />
        <div className="flex-1">
          <div className="font-semibold">
            {prDone ? "Опубликовано" : "Готово к публикации"}
          </div>
          <div className={`mt-0.5 text-[11px] ${hintClass}`}>
            {prDone
              ? "Ветка опубликована, pull request создан. Подтвердите и закройте задачу."
              : "Опубликуйте ветку в origin, затем создайте pull request через gigacode."}
          </div>
        </div>
        <button
          type="button"
          onClick={handlePush}
          disabled={pushDisabled}
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
          onClick={handleCreatePr}
          disabled={prDisabled}
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
      </div>
      {actionError && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {actionError}
        </div>
      )}
    </div>
  );
}