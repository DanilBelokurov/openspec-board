"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2 } from "lucide-react";

interface StartFormProps {
  tag: string;
}

export function StartForm({ tag }: StartFormProps) {
  const router = useRouter();
  const [jiraUrl, setJiraUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The "Начать работу" button is enabled only when the user has
  // typed a non-empty Jira URL. We trim before checking so a
  // string of whitespace doesn't unlock the button.
  const canSubmit = jiraUrl.trim().length > 0 && !submitting;

  async function handleStart() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jiraUrl: jiraUrl.trim() }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // /start transitions the task to "plan", creates the
      // feature/<jiraId> worktree and sets jiraUrl/codeBranch
      // on the task. The artifact-generation pipeline (openspec
      // instructions tasks + gigacode) is auto-triggered by
      // triggerContinueIfNeeded on the next server-component
      // render — refresh so the page picks up the new stage
      // badge, the worktree path, the Jira badge, and the
      // spawned gigacode card.
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
        <Play className="h-4 w-4 shrink-0 fill-emerald-700 text-emerald-700" />
        <div className="flex-1">
          <div className="font-semibold">Начать работу</div>
          <div className="mt-0.5 text-[11px] text-emerald-800/80">
            Введите ссылку на Jira-тикет, чтобы создать worktree на
            ветке <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[10px]">feature/&lt;JIRA-ID&gt;</code> и запустить генерацию tasks.md.
          </div>
        </div>
        <button
          type="button"
          onClick={handleStart}
          disabled={!canSubmit}
          className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-white" />
          )}
          <span>Начать работу</span>
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {error}
        </div>
      )}

      <div className="mt-3 space-y-3 border-t border-emerald-200/70 pt-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-slate-800">
            Ссылка на Jira-тикет
          </span>
          <input
            type="text"
            value={jiraUrl}
            onChange={(e) => setJiraUrl(e.target.value)}
            placeholder="https://company.atlassian.net/browse/ENG-123"
            disabled={submitting}
            className="h-8 rounded-md border border-border bg-white px-2 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300 disabled:bg-slate-50"
          />
          <span className="text-[11px] text-slate-500">
            Полный URL Jira-тикета. Из него возьмётся идентификатор
            вида <code className="font-mono">ENG-123</code> для имени ветки
            и пути worktree.
          </span>
        </label>
      </div>
    </div>
  );
}
