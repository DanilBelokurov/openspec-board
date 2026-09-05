"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Loader2, AlertCircle } from "lucide-react";

interface TakeOverButtonProps {
  tag: string;
}

/**
 * «Взять в работу» — promotes the remote task to a locally editable
 * one via POST /api/changes/<tag>/take-over. On success the state
 * flips (remote fields cleared), so a router.refresh() re-renders the
 * page as an ordinary local task: the read-only banner disappears and
 * the confirm/pencil buttons come back.
 */
export function TakeOverButton({ tag }: TakeOverButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const takeOver = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/take-over`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? `Ошибка ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setError("Не удалось выполнить запрос");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={takeOver}
        disabled={pending}
        className="flex h-7 items-center gap-1.5 rounded-md border border-blue-300 bg-blue-600 px-2.5 text-[12px] font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <UserPlus className="h-3.5 w-3.5" />
        )}
        <span>Взять в работу</span>
      </button>
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-red-700">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
