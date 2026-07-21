"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2 } from "lucide-react";

interface ConfirmButtonProps {
  changeName: string;
  taskTitle: string;
}

export function ConfirmButton({ changeName, taskTitle }: ConfirmButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(changeName)}/confirm`,
        { method: "POST" },
      );
      const data = await res.json();
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
    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-900">
      <div className="flex items-center gap-3">
        <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
        <div className="flex-1">
          <div className="font-semibold">Proposal готов</div>
          <div className="mt-0.5 text-[11px] text-emerald-800/80">
            Файл <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[10px]">proposal.md</code> создан в{" "}
            <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[10px]">
              {changeName}
            </code>
            . Подтвердите, чтобы перейти к следующему шагу.
          </div>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={submitting}
          className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCheck className="h-3.5 w-3.5" />
          )}
          <span>Подтверждено</span>
        </button>
      </div>
      {error && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {error}
        </div>
      )}
      <div className="mt-1 text-[10px] text-emerald-800/60">
        «{taskTitle}»
      </div>
    </div>
  );
}