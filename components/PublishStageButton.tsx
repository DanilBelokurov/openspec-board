"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2, AlertCircle, Check } from "lucide-react";

interface PublishStageButtonProps {
  tag: string;
  /** Label shown next to the icon; differs per stage. */
  label?: string;
}

/**
 * «Опубликовать» on a non-done analyst stage: writes the current
 * stage into .openspec.yaml, commits it and pushes the branch via
 * POST /api/changes/<tag>/publish-stage. After success the remote
 * scan of other users reads the stage from the metadata file instead
 * of guessing it from artifact presence.
 */
export function PublishStageButton({ tag, label }: PublishStageButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = async () => {
    setPending(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/publish-stage`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? `Ошибка ${res.status}`);
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("Не удалось выполнить запрос");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={publish}
        disabled={pending}
        className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : done ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <ArrowUp className="h-3.5 w-3.5" />
        )}
        <span>{label ?? "Опубликовать"}</span>
      </button>
      {error && (
        <p className="max-w-md text-[11px] text-red-700">
          <AlertCircle className="mr-1 inline h-3 w-3 align-[-1px]" />
          {error}
        </p>
      )}
    </div>
  );
}
