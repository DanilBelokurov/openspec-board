"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  UEK_REVIEW_COLUMNS,
  type UekReviewColumn,
  type UekReviewColumnMeta,
} from "@/lib/modes";
import type { UekPullRequest } from "@/lib/uek-expert/state";

/**
 * The UEK-expert review board. Shows the lifecycle of pull requests
 * assigned to the current user for review:
 *
 *   Новые → В процессе → Согласовано
 *                       ↘ Отклонено
 *
 * Data flows from `/api/uek-expert/items` (GET) for rendering and
 * `/api/uek-expert/scan` (POST) for both the manual "Обновить" button
 * and the periodic watcher tick.
 *
 * Column rendering:
 *
 *   - Persisted `column` from a prior user-driven move wins.
 *   - Otherwise we honour the MCP-reported terminal status:
 *       DECLINED state or NEEDS_WORK review  → "Отклонено"
 *       MERGED  state or APPROVED review     → "Согласовано"
 *   - Anything left falls into "Новые" so newly-discovered PRs
 *     surface immediately on the board.
 */

interface UekItemsResponse {
  pullRequests: Record<string, UekPullRequest>;
  lastScannedAt: string | null;
  lastScanError: string | null;
}

function renderColumnFor(
  pr: UekPullRequest,
): UekReviewColumn {
  if (pr.column) return pr.column;
  if (
    pr.state === "DECLINED" ||
    pr.reviewerStatus === "NEEDS_WORK"
  ) {
    return "rejected";
  }
  if (
    pr.state === "MERGED" ||
    pr.reviewerStatus === "APPROVED"
  ) {
    return "approved";
  }
  return "new";
}

function formatScanTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return date.toLocaleString();
}

export function UekReviewBoard() {
  const [items, setItems] = useState<Record<string, UekPullRequest>>({});
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  const [lastScanError, setLastScanError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/uek-expert/items", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as UekItemsResponse;
      setItems(data.pullRequests);
      setLastScannedAt(data.lastScannedAt);
      setLastScanError(data.lastScanError);
    } catch (e) {
      setScanError(
        e instanceof Error
          ? `Не удалось загрузить ПР: ${e.message}`
          : String(e),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const triggerScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await fetch("/api/uek-expert/scan", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
        );
      }
      if (Array.isArray(data.pullRequests)) {
        // Server returns an array — turn it back into the keyed
        // snapshot the items endpoint normally provides.
        const next: Record<string, UekPullRequest> = {};
        for (const pr of data.pullRequests as UekPullRequest[]) {
          next[`${pr.repository}:${pr.id}`] = pr;
        }
        setItems(next);
      }
      setLastScannedAt(
        typeof data.scannedAt === "string" ? data.scannedAt : new Date().toISOString(),
      );
      setLastScanError(null);
    } catch (e) {
      setScanError(
        e instanceof Error
          ? `Не удалось обновить список ПР: ${e.message}`
          : String(e),
      );
    } finally {
      setScanning(false);
      // Re-pull the canonical snapshot so the column state and
      // timestamps reflect whatever the server persisted.
      void refresh();
    }
  }, [refresh]);

  const prs = Object.values(items);
  const byColumn: Record<UekReviewColumn, UekPullRequest[]> = {
    new: [],
    "in-review": [],
    rejected: [],
    approved: [],
  };
  for (const pr of prs) {
    byColumn[renderColumnFor(pr)].push(pr);
  }

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-3">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[14px] font-semibold text-slate-900">
            Ревью пул-реквестов
          </h1>
          <p className="text-[11px] text-slate-500">
            ПР, в которых вы назначены ревьювером. Источник — bitbucket-mcp
            через gigacode. Периодический опрос и ручное обновление
            пересекаются по одному и тому же коду.
          </p>
          <p className="text-[11px] text-slate-500">
            Последнее сканирование: {formatScanTime(lastScannedAt)}
            {lastScanError && (
              <>
                {" "}
                <span className="text-red-700">
                  ошибка: {lastScanError}
                </span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void triggerScan()}
          disabled={scanning}
          title="Сканировать bitbucket-mcp прямо сейчас"
          aria-busy={scanning}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {scanning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span>Обновить</span>
        </button>
      </header>

      {scanError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700"
        >
          {scanError}
        </div>
      )}

      <div className="flex h-full min-h-0 gap-3 overflow-x-auto scrollbar-thin">
        {(Object.keys(UEK_REVIEW_COLUMNS) as UekReviewColumn[]).map((column) => (
          <UekColumn
            key={column}
            column={column}
            meta={UEK_REVIEW_COLUMNS[column]}
            items={byColumn[column]}
            loading={loading}
          />
        ))}
      </div>
    </div>
  );
}

function UekColumn({
  column,
  meta,
  items,
  loading,
}: {
  column: UekReviewColumn;
  meta: UekReviewColumnMeta;
  items: UekPullRequest[];
  loading: boolean;
}) {
  return (
    <section
      aria-label={meta.label}
      data-column={column}
      className="flex h-full w-72 shrink-0 flex-col gap-2 rounded-md border border-border bg-white/60 p-3"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-slate-700">
          {meta.label}
        </h2>
        <span className="text-[10px] font-medium text-slate-500">
          {items.length}
        </span>
      </header>
      <p className="text-[10px] text-slate-500">{meta.description}</p>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scrollbar-thin">
        {!loading && items.length === 0 ? (
          <li className="rounded-md border border-dashed border-border bg-slate-50 px-2.5 py-3 text-[11px] text-slate-500">
            Пусто. Сюда попадут ПР с этим состоянием.
          </li>
        ) : (
          items.map((pr) => (
            <li
              key={`${pr.repository}:${pr.id}`}
              className="flex flex-col gap-1 rounded-md border border-border bg-white px-2.5 py-2 shadow-sm"
            >
              <a
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold text-slate-900 hover:text-slate-700"
              >
                {pr.title}
              </a>
              <div className="text-[10px] text-slate-500">
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                  {pr.repository}
                </code>
              </div>
              <div className="text-[10px] text-slate-500">
                Автор:{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                  {pr.author}
                </code>
              </div>
              <div className="text-[10px] text-slate-500">
                reviewerStatus:{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                  {pr.reviewerStatus}
                </code>
                {" · state: "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                  {pr.state}
                </code>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
