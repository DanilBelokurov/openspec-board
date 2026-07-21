"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, ExternalLink, Loader2 } from "lucide-react";

interface StartFormProps {
  changeName: string;
  initialJiraUrl?: string;
  initialCodeRepoPath?: string;
}

interface StartSuccess {
  jiraId: string;
  jiraUrl: string;
  codeRepoPath: string;
  openspecWorktree: string;
  codeWorktree: string;
  gigacodePid: number | null;
  stage: string;
}

export function StartForm({
  changeName,
  initialJiraUrl = "",
  initialCodeRepoPath = "",
}: StartFormProps) {
  const router = useRouter();
  const [jiraUrl, setJiraUrl] = useState(initialJiraUrl);
  const [codeRepoPath, setCodeRepoPath] = useState(initialCodeRepoPath);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StartSuccess | null>(null);

  const canSubmit =
    jiraUrl.trim().length > 0 && codeRepoPath.trim().length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(changeName)}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jiraUrl, codeRepoPath }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(data);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-900">
        <div className="flex items-center gap-2 font-semibold">
          <Play className="h-3.5 w-3.5 fill-emerald-700" />
          <span>Запущено. Статус: {result.stage}</span>
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-emerald-700/70">Jira</dt>
          <dd>
            <a
              href={result.jiraUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              {result.jiraId}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </dd>
          <dt className="text-emerald-700/70">Openspec worktree</dt>
          <dd className="font-mono text-[10px] break-all">
            {result.openspecWorktree}
          </dd>
          <dt className="text-emerald-700/70">Code worktree</dt>
          <dd className="font-mono text-[10px] break-all">
            {result.codeWorktree}
          </dd>
          <dt className="text-emerald-700/70">gigacode PID</dt>
          <dd className="font-mono text-[10px]">
            {result.gigacodePid ?? "не запущен (gigacode не в PATH?)"}
          </dd>
        </dl>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-slate-800">
          Ссылка на Jira-тикет
        </span>
        <input
          type="text"
          value={jiraUrl}
          onChange={(e) => setJiraUrl(e.target.value)}
          placeholder="https://company.atlassian.net/browse/ENG-123"
          className="h-8 rounded-md border border-border bg-white px-2 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-slate-800">
          Путь к репозиторию с кодом
        </span>
        <input
          type="text"
          value={codeRepoPath}
          onChange={(e) => setCodeRepoPath(e.target.value)}
          placeholder="/Users/you/projects/myapp"
          className="h-8 rounded-md border border-border bg-white px-2 font-mono text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
        />
        <span className="text-[11px] text-slate-500">
          Абсолютный путь к git-репозиторию с кодом. Должен существовать и быть
          git-репо (содержать <code className="font-mono">.git</code>).
        </span>
      </label>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {submitting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5 fill-white" />
        )}
        <span>Начать</span>
      </button>

      <p className="text-[10px] text-slate-500">
        Создаст два git worktree (openspec + код) на ветке с Jira-id, переведёт
        задачу в «Декомпозиция» и запустит{" "}
        <code className="font-mono">
          gigacode --approval-mode=auto-edit --add-dir &lt;path&gt; -p
          "/opsx:plan ..."
        </code>
        .
      </p>
    </form>
  );
}