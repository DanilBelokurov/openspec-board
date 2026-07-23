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
 * Two-button cluster shown on the detail page for tasks in stage
 * "done" (analyst mode only — the page guards the surrounding
 * tree). The buttons drive the final deploy step:
 *
 *   - "Опубликовать ветку" → POST /api/changes/<tag>/push, which
 *     spawns `git push -u origin <branch>` detached. One-shot: the
 *     button becomes disabled once `pushedAt` is set, even if the
 *     user reloads the page.
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
      // Refresh so the next /deploy-status poll sees the new
      // pushedAt immediately.
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

  // The push button is one-shot: once the branch is up on the
  // remote, pushing again would either be a no-op or a server
  // policy error. Keep it disabled to make the lifecycle obvious
  // in the UI.
  const pushDisabled = pushed || pushInFlight;
  const prDisabled = !pushed || prInFlight;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
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
          className="flex h-7 items-center gap-1.5 rounded-md bg-sky-600 px-3 text-[12px] font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
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
          className="flex h-7 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-[12px] font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
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
        <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] text-red-700">
          {actionError}
        </div>
      )}
    </div>
  );
}