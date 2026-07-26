"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2 } from "lucide-react";

interface ImplementStartCardProps {
  /** Child task tag (the service-name directory). The card
   *  POSTs to `/api/changes/<tag>/implement`. */
  tag: string;
  /** True while a previous TDD gigacode run for this task
   *  is still alive — the button stays disabled until it
   *  finishes. The /implement endpoint enforces the same
   *  check (returns 409 on a still-alive PID) so the client
   *  side is just a UX hint. */
  disabled?: boolean;
}

/**
 * "Запустить реализацию" card for child develop tasks.
 * Mirrors the green-bordered style of ConfirmArtifactButton /
 * ServiceSelectionCard so it sits naturally on the detail
 * page. On click, POSTs to /api/changes/<tag>/implement
 * which spawns the per-service TDD gigacode run inside the
 * child's code-repo worktree. The exit code is written back
 * to `task.implementExitCode` asynchronously; the page
 * re-fetches on 2xx so the new process card appears with
 * the running spinner.
 */
export function ImplementStartCard({ tag, disabled }: ImplementStartCardProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/implement`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // /implement returns 202 with the gigacode PID. The
      // process card re-renders with the live spinner once
      // the page re-fetches.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-900">
      <div className="flex items-center gap-3">
        <Play className="h-4 w-4 shrink-0 fill-emerald-700 text-emerald-700" />
        <div className="flex-1">
          <div className="font-semibold">Запустить реализацию</div>
          <div className="mt-0.5 text-[11px] text-emerald-800/80">
            Запустит TDD-цикл в worktree сервиса. Перед запуском прочитает tasks.md из openspec-репо.
          </div>
        </div>
        <button
          type="button"
          onClick={handleStart}
          disabled={disabled || submitting}
          className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-white" />
          )}
          <span>Запустить</span>
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
