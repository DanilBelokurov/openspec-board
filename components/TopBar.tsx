"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Settings, RefreshCw } from "lucide-react";

export function TopBar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function handleRefresh() {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 700);
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border bg-surface-raised px-4">
      <button
        type="button"
        className="flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2.5 text-[12px] font-medium text-white hover:bg-slate-800"
      >
        <Plus className="h-3.5 w-3.5" />
        <span>New session</span>
      </button>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          aria-label="Open settings"
          aria-haspopup="menu"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
          className={`flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white text-slate-700 hover:bg-slate-50 ${
            settingsOpen ? "bg-slate-100" : ""
          }`}
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
        {settingsOpen && (
          <div
            role="menu"
            className="absolute right-0 top-9 z-20 w-56 rounded-md border border-border bg-white py-1 shadow-cardHover"
          >
            <button
              role="menuitem"
              className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-50"
            >
              Workspace settings
            </button>
            <button
              role="menuitem"
              className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-50"
            >
              Theme
            </button>
            <button
              role="menuitem"
              className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-50"
            >
              OpenSpec directory…
            </button>
            <div className="my-1 h-px bg-border-subtle" />
            <button
              role="menuitem"
              className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-50"
            >
              About
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        aria-label="Refresh"
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
  );
}