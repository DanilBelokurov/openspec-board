"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Settings, RefreshCw, FilePlus, Users, User, UserRound } from "lucide-react";
import type { BoardModeId } from "@/lib/modes";
import { SettingsDialog } from "./SettingsDialog";
import { useCreateProposal } from "./CreateProposalContext";

interface TopBarProps {
  mode: BoardModeId;
  /**
   * Current author-filter selection from the URL.
   * `undefined` / "all" → no filter; the toggle group
   * highlights "Все".
   */
  authorFilter?: "mine" | "others" | "all";
  /**
   * `true` when the configured user has an email. The filter
   * group is hidden entirely without it — the URL param is
   * a no-op and `app/page.tsx` always shows everything.
   */
  hasUserEmail?: boolean;
}

export function TopBar({ mode, authorFilter = "all", hasUserEmail = false }: TopBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const createProposal = useCreateProposal();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Build an href that swaps the `author` query param while
   * preserving every other param (e.g. `?sort=priority`) so
   * the toggle composes with whatever the rest of the app
   * adds to the URL later.
   */
  function buildHref(filter: "mine" | "others" | "all"): string {
    const params = new URLSearchParams(searchParams.toString());
    if (filter === "all") params.delete("author");
    else params.set("author", filter);
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    const start = Date.now();
    // Mode-aware refresh endpoint: the openspec-aware modes
    // (developer / analyst) scan through `/api/refresh`, which
    // runs the openspec pipelines and needs `config.openspecDir`.
    // UEK-expert has its own MCP-driven scan at
    // `/api/uek-expert/scan`, which does NOT touch the
    // openspecDir — going through `/api/refresh` here would
    // hit its "Сначала укажите директорию OpenSpec store" guard
    // and refuse to run.
    const endpoint =
      mode === "uek-expert" ? "/api/uek-expert/scan" : "/api/refresh";
    try {
      const res = await fetch(endpoint, { method: "POST" });
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
              onClick={() => createProposal.open()}
              className="flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2.5 text-[12px] font-medium text-white hover:bg-slate-800"
            >
              <FilePlus className="h-3.5 w-3.5" />
              <span>Новый proposal</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Author-filter group. Hidden when no user.email is
              configured — without an identity the comparison
              has nothing to anchor against, so we suppress the
              control rather than show a degenerate "Все". */}
          {hasUserEmail && (
            <div
              role="radiogroup"
              aria-label="Фильтр по автору"
              className="flex h-7 items-center overflow-hidden rounded-md border border-border bg-white text-[11px] text-slate-700"
            >
              <Link
                href={buildHref("all")}
                replace
                scroll={false}
                aria-pressed={authorFilter === "all"}
                role="radio"
                className={`flex h-full items-center gap-1 px-2 hover:bg-slate-50 ${
                  authorFilter === "all" ? "bg-slate-100 font-medium" : ""
                }`}
                title="Показать все задачи"
              >
                <Users className="h-3 w-3" />
                <span>Все</span>
              </Link>
              <Link
                href={buildHref("mine")}
                replace
                scroll={false}
                aria-pressed={authorFilter === "mine"}
                role="radio"
                className={`flex h-full items-center gap-1 border-l border-border px-2 hover:bg-slate-50 ${
                  authorFilter === "mine" ? "bg-slate-100 font-medium" : ""
                }`}
                title="Только мои задачи (локальные + опубликованные мной)"
              >
                <User className="h-3 w-3" />
                <span>Мои</span>
              </Link>
              <Link
                href={buildHref("others")}
                replace
                scroll={false}
                aria-pressed={authorFilter === "others"}
                role="radio"
                className={`flex h-full items-center gap-1 border-l border-border px-2 hover:bg-slate-50 ${
                  authorFilter === "others" ? "bg-slate-100 font-medium" : ""
                }`}
                title="Только задачи других пользователей"
              >
                <UserRound className="h-3 w-3" />
                <span>Чужие</span>
              </Link>
            </div>
          )}
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
    </>
  );
}