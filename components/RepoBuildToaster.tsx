"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, X, CircleAlert } from "lucide-react";

/**
 * Toast notifications for repo code-review-graph build completion.
 *
 * Polls /api/repos/build-status every POLL_MS and shows a small
 * floating toast for each repo whose build just finished (either
 * success or failure). Each toast has a 'Notified' sessionStorage
 * flag so the same completion isn't shown twice in a row.
 */

const POLL_MS = 5000;
const SESSION_KEY = "sdd-board.repoBuilds.notified";

interface RepoBuild {
  name: string;
  buildPid: number | null;
  buildStartedAt?: string;
  buildExitCode: number | null;
  buildLogPath?: string;
}

function readNotified(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((x) => typeof x === "string"));
  } catch {
    /* ignore */
  }
  return new Set();
}

function writeNotified(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify(Array.from(set)),
    );
  } catch {
    /* ignore — quota / disabled */
  }
}

function classify(build: RepoBuild): "running" | "done" | "failed" | null {
  if (build.buildPid == null) {
    // No build was spawned for this repo — but if it ever had an
    // exit code (e.g. watcher already wrote it), still classify.
    if (build.buildExitCode == null) return null;
    return build.buildExitCode === 0 ? "done" : "failed";
  }
  if (build.buildExitCode == null) return "running";
  return build.buildExitCode === 0 ? "done" : "failed";
}

function keyFor(name: string, status: "done" | "failed"): string {
  return `${name}:${status}`;
}

export function RepoBuildToaster() {
  const [toasts, setToasts] = useState<
    { name: string; status: "done" | "failed"; logPath?: string }[]
  >([]);
  const notifiedRef = useRef<Set<string>>(new Set());
  const seenNamesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    notifiedRef.current = readNotified();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const res = await fetch("/api/repos/build-status", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { repos: RepoBuild[] };
        if (cancelled) return;

        // Detect transitions: a build that just appeared as
        // running now, then completed, gets toasted once.
        const newlyDone: { name: string; status: "done" | "failed"; logPath?: string }[] = [];
        const stillRunning = new Set<string>();

        for (const build of data.repos ?? []) {
          const status = classify(build);
          if (!status) continue;
          if (status === "running") {
            stillRunning.add(build.name);
          } else {
            const id = keyFor(build.name, status);
            if (
              seenNamesRef.current.has(build.name) &&
              !notifiedRef.current.has(id)
            ) {
              newlyDone.push({
                name: build.name,
                status,
                logPath: build.buildLogPath,
              });
              notifiedRef.current.add(id);
              writeNotified(notifiedRef.current);
            }
          }
        }
        // Forget names whose build was reset (rare, only on repo
        // re-add) so the next completion is shown again.
        for (const name of seenNamesRef.current) {
          if (!stillRunning.has(name) && !data.repos?.find((b) => b.name === name)) {
            seenNamesRef.current.delete(name);
          }
        }
        for (const build of data.repos ?? []) {
          seenNamesRef.current.add(build.name);
        }

        if (newlyDone.length > 0) {
          setToasts((prev) => [...prev, ...newlyDone]);
        }
      } catch {
        /* ignore — the next tick will retry */
      }
    }

    void poll();
    const handle = setInterval(() => {
      void poll();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  function dismiss(index: number) {
    setToasts((prev) => prev.filter((_, i) => i !== index));
  }

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t, i) => (
        <div
          key={`${t.name}-${t.status}-${i}`}
          role="status"
          className={`pointer-events-auto flex w-72 items-start gap-2 rounded-md border bg-white px-3 py-2 shadow-lg ${
            t.status === "done"
              ? "border-emerald-200"
              : "border-red-200"
          }`}
        >
          {t.status === "done" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          )}
          <div className="min-w-0 flex-1 text-[12px] text-slate-800">
            <div className="font-semibold">
              {t.status === "done"
                ? "Граф построен"
                : "Ошибка построения графа"}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-600">
              Репозиторий{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                {t.name}
              </code>
              .
              {t.status === "failed" && (
                <>
                  {" "}
                  См.{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                    {t.logPath ?? "лог"}
                  </code>
                  .
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => dismiss(i)}
            aria-label="Закрыть уведомление"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}