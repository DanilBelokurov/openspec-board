"use client";

import { useState } from "react";
import { Plus, Settings, RefreshCw } from "lucide-react";
import { SettingsDialog } from "./SettingsDialog";

export function TopBar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  function handleRefresh() {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 700);
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border bg-surface-raised px-4">
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2.5 text-[12px] font-medium text-white hover:bg-slate-800"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Новая сессия</span>
        </button>

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
      </header>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}