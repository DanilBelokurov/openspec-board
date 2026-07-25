"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, X, CircleAlert } from "lucide-react";

/**
 * Toast notifications for repo code-review-graph completion.
 *
 * Polls /api/repos/build-status every POLL_MS and shows a small
 * floating toast for each repo whose two-step pipeline
 * (build → wiki) has just finished. The pipeline is considered
 * 'done' only after the wiki step exits with code 0.
 *
 * Each toast has a 'Notified' sessionStorage flag so the same
 * completion isn't shown twice in a row.
 */

const POLL_MS = 5000;
const SESSION_KEY = "sdd-board.repoBuilds.notified";

interface RepoBuild {
  name: string;
  buildPid: number | null;
  buildStartedAt?: string;
  buildExitCode: number | null;
  buildLogPath?: string;
  buildError?: string | null;
  wikiPid: number | null;
  wikiStartedAt?: string;
  wikiExitCode: number | null;
  wikiLogPath?: string;
  wikiError?: string | null;
}

type PipelineStage =
  | "idle"
  | "building"
  | "wiki"
  | "done"
  | "failed";

/**
 * Reduce a repo's build + wiki state to a single stage.
 * `done` and `failed` are terminal — those are the only states
 * that should surface a toast. We look at wiki first because
 * "pipeline is done" means wiki finished.
 *
 * Two non-happy paths route to `failed`:
 *   - any non-zero exit code on either step
 *   - a recorded spawn error (gigacode missing, etc.) — in that
 *     case the PID is null and there's an `error` string the
 *     toaster surfaces verbatim.
 */
function classify(build: RepoBuild): PipelineStage {
  if (build.wikiExitCode != null) {
    return build.wikiExitCode === 0 ? "done" : "failed";
  }
  if (build.buildExitCode != null) {
    if (build.buildExitCode !== 0) return "failed";
    // build OK — wiki is the next thing to wait on
    return build.wikiPid != null ? "wiki" : "building";
  }
  if (build.buildPid != null) return "building";
  // PID is null and we have a startedAt + error → spawn failed.
  // Without the error field (legacy entries) we'd return idle
  // here; that's fine, those entries are pre-error-tracking.
  if (build.buildStartedAt && build.buildError) return "failed";
  return "idle";
}

function keyFor(name: string, status: "done" | "failed"): string {
  return `${name}:${status}`;
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

export function RepoBuildToaster() {
  const [toasts, setToasts] = useState<
    {
      name: string;
      status: "done" | "failed";
      logPath?: string;
      error?: string | null;
    }[]
  >([]);
  const notifiedRef = useRef<Set<string>>(new Set());

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

        const newlyDone: {
          name: string;
          status: "done" | "failed";
          logPath?: string;
          error?: string | null;
        }[] = [];

        for (const build of data.repos ?? []) {
          const stage = classify(build);
          if (stage !== "done" && stage !== "failed") continue;
          // Toast every terminal-state repo we haven't notified about
          // yet. This catches two cases that the old "seen first"
          // guard missed:
          //   - the repo completed before this page mounted
          //     (the first poll already classifies it as done/failed)
          //   - the build/wiki never started (gigacode missing, etc.)
          const id = keyFor(build.name, stage);
          if (notifiedRef.current.has(id)) continue;
          newlyDone.push({
            name: build.name,
            status: stage,
            logPath: build.wikiLogPath ?? build.buildLogPath,
            error: build.wikiError ?? build.buildError ?? null,
          });
          notifiedRef.current.add(id);
          writeNotified(notifiedRef.current);
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
                ? "Граф и wiki построены"
                : "Ошибка построения графа"}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-600">
              Репозиторий{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                {t.name}
              </code>
              .{" "}
              {t.status === "failed" && (
                <>
                  {t.error ? (
                    <span className="block break-words text-red-700">
                      {t.error}
                    </span>
                  ) : (
                    <>
                      См.{" "}
                      <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                        {t.logPath ?? "лог"}
                      </code>
                      .
                    </>
                  )}
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
