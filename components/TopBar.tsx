"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Settings, RefreshCw, FilePlus } from "lucide-react";
import type { BoardModeId } from "@/lib/modes";
import { SettingsDialog } from "./SettingsDialog";
import { CreateProposalDialog } from "./CreateProposalDialog";

interface TopBarProps {
  mode: BoardModeId;
}

export function TopBar({ mode }: TopBarProps) {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    const start = Date.now();
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefreshError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      startTransition(() => {
        router.refresh();
      });
      const elapsed = Date.now() - start;
      const minDuration = 700;
      if (elapsed < minDuration) {
        await new Promise((r) => setTimeout(r, minDuration - elapsed));
      }
    } catch (e) {
      setRefreshError(String(e));
    } finally {
      setRefreshing(false);
      if (refreshError) setTimeout(() => setRefreshError(null), 4000);
    }
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface-raised px-4">
        <div className="flex items-center gap-2">
          {mode === "analyst" && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2.5 text-[12px] font-medium text-white hover:bg-slate-800"
            >
              <FilePlus className="h-3.5 w-3.5" />
              <span>Новый proposal</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Открыть настройки"
            onClick={() => setSettingsOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white text-slate-700 hover:bg-slate-50"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            aria-label="Обновить"
            onClick={handleRefresh}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-slate-700 transition-transform duration-700 ease-out ${
                refreshing ? "rotate-[360deg]" : ""
              }`}
            />
          </button>
        </div>
      </header>

      {refreshError && (
        <div
          role="alert"
          className="fixed right-4 top-16 z-40 max-w-sm rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 shadow-cardHover"
        >
          ⚠ {refreshError}
        </div>
      )}

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <CreateProposalDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}