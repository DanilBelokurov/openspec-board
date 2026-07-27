"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw } from "lucide-react";

interface RestartSubtaskButtonProps {
  /** Child task tag (the service-name directory). */
  tag: string;
  /** Which TDD phase to restart. */
  phase: "red" | "green";
}

/**
 * "Перезапустить" button for a failed TDD sub-task on the develop
 * page. Mirrors the implementation pattern of `ImplementStartCard`:
 * POSTs to the new `/api/changes/<tag>/implement/restart` endpoint
 * with `{ phase }`, shows a spinner while the gigacode process is
 * being spawned, and refreshes the page on success so the parent
 * process card flips back to the live-spinner state.
 *
 * Stylistically distinct from the green "Запустить" and the amber
 * "Подтвердить" buttons: slate-700 background reads as a recovery
 * action rather than a primary advance. Disabled while submitting
 * to prevent double-spawns (the server enforces the same check
 * and returns 409 if the previous run is still alive).
 */
export function RestartSubtaskButton({ tag, phase }: RestartSubtaskButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestart() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/implement/restart`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase }),
        },
      );
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
        disabled={submitting}
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
