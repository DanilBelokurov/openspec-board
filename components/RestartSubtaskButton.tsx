"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw } from "lucide-react";

/**
 * Sub-task target for an analyst-mode restart. Mirrors the
 * discriminated set in `app/api/changes/[tag]/analyst/restart/route.ts`:
 * the same `{stage, sub}` body shape is POSTed there verbatim.
 */
export type AnalystSub = "openspec-new" | "create" | "update" | "push" | "pull-request";

export type AnalystStage =
  | "proposal"
  | "delta-spec"
  | "design"
  | "adr"
  | "done";

interface RestartSubtaskButtonProps {
  /** Change tag the failing sub-task belongs to. */
  tag: string;
  /**
   * Developer-mode TDD phase (RED / GREEN). When set, POSTs to
   * `/api/changes/<tag>/implement/restart` with `{ phase }`.
   * Mutually exclusive with `stage` / `sub`.
   */
  phase?: "red" | "green";
  /**
   * Analyst-mode restart target. When both `stage` and `sub`
   * are set, POSTs to `/api/changes/<tag>/analyst/restart`
   * with `{ stage, sub }`.
   */
  stage?: AnalystStage;
  sub?: AnalystSub;
}

/**
 * "Перезапустить" button for a failed TDD sub-task on the
 * develop page (developer mode) or for any failed analyst-mode
 * sub-task on the change detail page. Two endpoints, one
 * component, one visual style — slate-700 background reads as
 * a recovery action rather than a primary advance. Disabled
 * while submitting to prevent double-spawns; the server
 * enforces the same check and returns 409 if the previous run
 * is still alive.
 */
export function RestartSubtaskButton({
  tag,
  phase,
  stage,
  sub,
}: RestartSubtaskButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const developerMode = phase != null;
  const analystMode = stage != null && sub != null;
  const configured = developerMode || analystMode;
  if (!configured) {
    // Misconfiguration at the call site. Surface loudly in dev;
    // silently no-op in production to avoid breaking the page.
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "RestartSubtaskButton requires either `phase` (developer) or `stage`+`sub` (analyst)",
      );
    }
  }

  async function handleRestart() {
    if (!configured) return;
    setSubmitting(true);
    setError(null);
    try {
      const url = developerMode
        ? `/api/changes/${encodeURIComponent(tag)}/implement/restart`
        : `/api/changes/${encodeURIComponent(tag)}/analyst/restart`;
      const body = developerMode ? { phase } : { stage, sub };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleRestart}
        disabled={submitting || !configured}
        className="flex h-7 items-center gap-1.5 rounded-md bg-slate-700 px-2.5 text-[11px] font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {submitting ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RotateCw className="h-3 w-3" />
        )}
        <span>Перезапустить</span>
      </button>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}