"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, FolderSearch, Plus, Loader2, Trash2 } from "lucide-react";
import { MODES, type BoardModeId } from "@/lib/modes";
import { useCreateProposal } from "./CreateProposalContext";
import { deriveRepoNameFromUrl } from "@/lib/repo-name";

interface RepoEntry {
  url: string;
  branch: string;
}

interface RepoAddState {
  submitting: boolean;
  error: string | null;
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type Status = "idle" | "saving" | "saved" | "error";

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const router = useRouter();
  const [path, setPath] = useState("");
  const [initialPath, setInitialPath] = useState("");
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [mode, setMode] = useState<BoardModeId>("developer");
  const [initialMode, setInitialMode] = useState<BoardModeId>("developer");
  const [defaultBranch, setDefaultBranch] = useState("master");
  const [initialDefaultBranch, setInitialDefaultBranch] = useState("master");
  const [developerScanInterval, setDeveloperScanInterval] = useState(0);
  const [initialDeveloperScanInterval, setInitialDeveloperScanInterval] =
    useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Repos section state
  const [repos, setRepos] = useState<Record<string, RepoEntry>>({});
  const [initialRepos, setInitialRepos] = useState<Record<string, RepoEntry>>({});
  const [newRepoUrl, setNewRepoUrl] = useState("");
  const [newRepoBranch, setNewRepoBranch] = useState("");
  const [repoAdd, setRepoAdd] = useState<RepoAddState>({
    submitting: false,
    error: null,
  });

  useEffect(() => {
    if (!open) return;
    setStatus("idle");
    setError(null);
    setPickedName(null);
    setNewRepoUrl("");
    setNewRepoBranch("");
    setRepoAdd({ submitting: false, error: null });
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        const v = data?.openspecDir ?? "";
        setPath(v);
        setInitialPath(v);
        const m: BoardModeId = data?.mode === "analyst" ? "analyst" : "developer";
        setMode(m);
        setInitialMode(m);
        const b: string =
          typeof data?.defaultBranch === "string" &&
          data.defaultBranch.trim().length > 0
            ? data.defaultBranch
            : "master";
        setDefaultBranch(b);
        setInitialDefaultBranch(b);
        const interval =
          typeof data?.developerScanIntervalMinutes === "number" &&
          Number.isFinite(data.developerScanIntervalMinutes)
            ? data.developerScanIntervalMinutes
            : 0;
        setDeveloperScanInterval(interval);
        setInitialDeveloperScanInterval(interval);
        const r: Record<string, RepoEntry> =
          data?.repos && typeof data.repos === "object" ? data.repos : {};
        setRepos(r);
        setInitialRepos(r);
      })
      .catch((e) => setError(String(e)));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function save() {
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openspecDir: path.trim(),
          mode,
          defaultBranch: defaultBranch.trim(),
          developerScanIntervalMinutes: developerScanInterval,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setInitialPath(data.openspecDir ?? "");
      setInitialMode(data.mode ?? mode);
      setInitialDefaultBranch(data.defaultBranch ?? defaultBranch);
      setInitialDeveloperScanInterval(
        data.developerScanIntervalMinutes ?? developerScanInterval,
      );
      setStatus("saved");
      router.refresh();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function addRepo() {
    setRepoAdd({ submitting: true, error: null });
    const trimmedUrl = newRepoUrl.trim();
    const trimmedBranch = newRepoBranch.trim();
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmedUrl,
          branch: trimmedBranch,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRepoAdd({
          submitting: false,
          error: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      // Server tells us the canonical name it used (derived from URL).
      const name: string = data.repo?.name ?? deriveRepoNameFromUrl(trimmedUrl) ?? "";
      if (!name) {
        setRepoAdd({
          submitting: false,
          error: "Сервер не вернул имя репозитория",
        });
        return;
      }
      const next = {
        ...repos,
        [name]: { url: trimmedUrl, branch: trimmedBranch },
      };
      setRepos(next);
      setInitialRepos(next);
      setNewRepoUrl("");
      setNewRepoBranch("");
      setRepoAdd({ submitting: false, error: null });
    } catch (e) {
      setRepoAdd({
        submitting: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function removeRepo(name: string) {
    // The backend DELETE handler ships in a follow-up commit; for
    // now we just drop it from local state and let the next save
    // reflect that. The submodule on disk will be removed when the
    // matching DELETE endpoint lands.
    const next = { ...repos };
    delete next[name];
    setRepos(next);
    setInitialRepos(next);
    // Best-effort: also tell the server. If it fails, fall back to
    // a local-only delete so the dialog isn't stuck.
    try {
      await fetch(
        `/api/repos/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
    } catch {
      /* ignore — local state already updated */
    }
    router.refresh();
  }

  function handleFolderPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const first = files[0] as File & { webkitRelativePath?: string };
    const rel = first.webkitRelativePath ?? "";
    const top = rel.split("/")[0] ?? "";
    setPickedName(top || first.name);
    e.target.value = "";
  }

  const dirty =
    path !== initialPath ||
    mode !== initialMode ||
    defaultBranch !== initialDefaultBranch ||
    developerScanInterval !== initialDeveloperScanInterval;

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-white shadow-cardHover"
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2
            id="settings-title"
            className="text-[14px] font-semibold text-slate-900"
          >
            Настройки
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть настройки"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-slate-800">
              Режим доски
            </span>
            <div
              role="radiogroup"
              aria-label="Режим доски"
              className="flex rounded-md border border-border bg-slate-50 p-0.5"
            >
              {Object.values(MODES).map((m) => {
                const active = mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setMode(m.id)}
                    className={`flex-1 rounded px-2.5 py-1 text-[12px] font-medium transition ${
                      active
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-slate-500">
              «Разработчик» — 7 этапов реализации (бэклог → готово). «Аналитик» —
              5 этапов подготовки change-proposal (намерение → готово). Задачи
              отображаются только если их stage входит в выбранный режим.
            </span>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-slate-800">
              Директория OpenSpec store
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/Users/me/projects/openspec-store/main"
                className="h-8 flex-1 rounded-md border border-border bg-white px-2 font-mono text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                style={{ display: "none" }}
                onChange={handleFolderPick}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Открыть выбор папки — браузер отдаст только её имя, абсолютный путь нужно ввести вручную"
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <FolderSearch className="h-3.5 w-3.5" />
                <span>Обзор…</span>
              </button>
            </div>
            {pickedName && (
              <span className="text-[11px] text-slate-500">
                Выбрана папка:{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
                  {pickedName}
                </code>{" "}
                — вставьте полный абсолютный путь в поле выше.
              </span>
            )}
            <span className="text-[11px] text-slate-500">
              Абсолютный путь на диске. Сохраняется в{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
                .sdd-board/config.json
              </code>{" "}
              и переживает перезапуск.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-slate-800">
              Главная ветка OpenSpec store
            </span>
            <input
              type="text"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              placeholder="master"
              className="h-8 rounded-md border border-border bg-white px-2 font-mono text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            <span className="text-[11px] text-slate-500">
              Имя ветки в репозитории OpenSpec store, от которой ответвляются
              feature-ветки при создании proposal. По умолчанию{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
                master
              </code>
              . Перед созданием worktree эта ветка обновляется из{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
                origin/&lt;ветка&gt;
              </code>
              .
            </span>
          </label>

          {mode === "developer" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-slate-800">
                Интервал автосканирования (мин)
              </span>
              <input
                type="number"
                min={0}
                max={1440}
                value={developerScanInterval}
                onChange={(e) =>
                  setDeveloperScanInterval(
                    Math.max(0, Number(e.target.value) || 0),
                  )
                }
                placeholder="0"
                className="h-8 w-32 rounded-md border border-border bg-white px-2 font-mono text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
              <span className="text-[11px] text-slate-500">
                Каждые N минут фоновый watcher сканирует{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
                  origin/{defaultBranch || "master"}
                </code>{" "}
                на наличие новых change-proposal и добавляет их в
                бэклог.{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
                  0
                </code>{" "}
                — отключить авто-сканирование (только по кнопке ↻).
              </span>
            </label>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-slate-800">
              Репозитории (git submodules)
            </span>

            {Object.keys(repos).length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {Object.entries(repos).map(([name, repo]) => (
                  <li
                    key={name}
                    className="flex items-start gap-2 rounded-md border border-border bg-slate-50 px-2.5 py-1.5 text-[11px]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[12px] font-semibold text-slate-800">
                        {name}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-slate-500">
                        <span className="text-slate-400">URL:</span>{" "}
                        <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px]">
                          {repo.url}
                        </code>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        <span className="text-slate-400">Ветка:</span>{" "}
                        <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px]">
                          {repo.branch}
                        </code>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRepo(name)}
                      title="Удалить репозиторий"
                      aria-label={`Удалить репозиторий ${name}`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500">
                Нет добавленных репозиториев. Заполните форму ниже, чтобы
                установить submodule в <code className="font-mono">repos/&lt;имя&gt;</code>{" "}
                и сразу перейти на указанную ветку.
              </div>
            )}

            <div className="grid gap-1.5">
              <input
                type="text"
                value={newRepoUrl}
                onChange={(e) => setNewRepoUrl(e.target.value)}
                placeholder="URL (https://github.com/... или git@github.com:...)"
                className="h-8 rounded-md border border-border bg-white px-2 font-mono text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
              {newRepoUrl.trim() && (
                <div className="text-[11px] text-slate-500">
                  Имя (из URL):{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                    {deriveRepoNameFromUrl(newRepoUrl) ?? "— не удалось извлечь —"}
                  </code>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newRepoBranch}
                  onChange={(e) => setNewRepoBranch(e.target.value)}
                  placeholder="Ветка (master, main, dev, …)"
                  className="h-8 flex-1 rounded-md border border-border bg-white px-2 font-mono text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
                />
                <button
                  type="button"
                  onClick={addRepo}
                  disabled={
                    repoAdd.submitting ||
                    newRepoUrl.trim() === "" ||
                    newRepoBranch.trim() === "" ||
                    !deriveRepoNameFromUrl(newRepoUrl)
                  }
                  className="flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {repoAdd.submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  <span>Добавить</span>
                </button>
              </div>
            </div>

            {repoAdd.error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
                {repoAdd.error}
              </div>
            )}

            <span className="text-[11px] text-slate-500">
              После добавления репозиторий появится в{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                &lt;openspecDir&gt;/repos/&lt;имя&gt;
              </code>{" "}
              как git submodule и сразу переключится на указанную ветку.
            </span>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
              {error}
            </div>
          )}
          {status === "saved" && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
              Сохранено. Новое значение будет использоваться при следующих запусках.
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded-md border border-border bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || status === "saving"}
            className="h-7 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {status === "saving" ? "Сохранение…" : "Сохранить"}
          </button>
        </footer>
      </div>
    </div>
  );
}