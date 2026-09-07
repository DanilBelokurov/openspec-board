"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, FolderSearch, Plus, Loader2, Trash2 } from "lucide-react";
import { MODES, isBoardModeId, type BoardModeId } from "@/lib/modes";
import { useCreateProposal } from "./CreateProposalContext";
import {
  deriveRepoNameFromUrl,
  normalizeRepoName,
} from "@/lib/repo-name";

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
  // Remote-scan cadence (analyst mode only). Default 5 min — see
  // DEFAULT_REMOTE_SCAN_MINUTES in lib/watcher.ts. 0 disables.
  const [remoteScanInterval, setRemoteScanInterval] = useState(5);
  const [initialRemoteScanInterval, setInitialRemoteScanInterval] = useState(5);
  // UEK-expert mode scan cadence (uek-expert mode only). Default
  // 5 min — see DEFAULT_UEK_SCAN_MINUTES in lib/watcher.ts. 0
  // disables background polling; the manual "Обновить" button
  // still works.
  const [uekScanInterval, setUekScanInterval] = useState(5);
  const [initialUekScanInterval, setInitialUekScanInterval] = useState(5);
  // User identity (multi-user read-only). Auto-populated from
  // `git config user.email` on first save; the user can override.
  const [userEmail, setUserEmail] = useState("");
  const [initialUserEmail, setInitialUserEmail] = useState("");
  const [userDisplayName, setUserDisplayName] = useState("");
  const [initialUserDisplayName, setInitialUserDisplayName] = useState("");
  // Detected identity shown as a hint: "from repo config / global config"
  // so the user understands where the auto-fill value came from.
  const [gitIdentityHint, setGitIdentityHint] = useState<{
    email: string | null;
    name: string | null;
    source: "repo" | "global" | null;
  } | null>(null);
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
  const [removingName, setRemovingName] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus("idle");
    setError(null);
    setPickedName(null);
    setNewRepoUrl("");
    setNewRepoBranch("");
    setRepoAdd({ submitting: false, error: null });
    setRemovingName(null);
    setRemoveError(null);
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        const v = data?.openspecDir ?? "";
        setPath(v);
        setInitialPath(v);
        const m: BoardModeId = isBoardModeId(data?.mode) ? data.mode : "developer";
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
        const rInterval =
          typeof data?.remoteScanIntervalMinutes === "number" &&
          Number.isFinite(data.remoteScanIntervalMinutes)
            ? data.remoteScanIntervalMinutes
            : 5;
        setRemoteScanInterval(rInterval);
        setInitialRemoteScanInterval(rInterval);
        const uInterval =
          typeof data?.uekExpertScanIntervalMinutes === "number" &&
          Number.isFinite(data.uekExpertScanIntervalMinutes)
            ? data.uekExpertScanIntervalMinutes
            : 5;
        setUekScanInterval(uInterval);
        setInitialUekScanInterval(uInterval);
        // User identity — fall back to "" when not configured so
        // the input is empty (placeholder is shown instead).
        const u = data?.user ?? {};
        const uEmail = typeof u.email === "string" ? u.email : "";
        const uName = typeof u.displayName === "string" ? u.displayName : "";
        setUserEmail(uEmail);
        setInitialUserEmail(uEmail);
        setUserDisplayName(uName);
        setInitialUserDisplayName(uName);
        const r: Record<string, RepoEntry> =
          data?.repos && typeof data.repos === "object" ? data.repos : {};
        setRepos(r);
        setInitialRepos(r);
        // Fetch git identity hint (only when openspecDir is
        // configured — the endpoint requires a valid repo).
        if (v) {
          fetch("/api/config/git-identity")
            .then((r) => (r.ok ? r.json() : null))
            .then((hint) => {
              if (hint && (hint.email || hint.name)) {
                setGitIdentityHint(hint);
                // Auto-fill the email field if the user hasn't
                // already configured one — saves a click on
                // first run. We don't overwrite an existing
                // config.user.email value.
                if (!uEmail && hint.email) {
                  setUserEmail(hint.email);
                }
              }
            })
            .catch(() => {
              // Non-fatal: the hint is informational.
            });
        }
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

  // Live preview of the repo name we'll feed to /api/repos.
  // Mirrors the server pipeline (deriveRepoNameFromUrl →
  // normalizeRepoName) so the user sees the exact kebab-case key
  // before submitting, plus a small "из <raw>" hint when the URL
  // segment wasn't already canonical. Without this they'd be
  // surprised that "My_Repo.git" lands as repos/my-repo/.
  //
  // MUST run unconditionally — keeping it above the `if (!open)`
  // early-return preserves the same hook order across renders and
  // avoids React's "Rendered more hooks than during the previous
  // render" error (the first mount can see open=false, while later
  // mounts reach this line).
  const newRepoPreview = useMemo(() => {
    const raw = deriveRepoNameFromUrl(newRepoUrl);
    if (!raw) return { ok: false as const, reason: "missing" as const };
    const norm = normalizeRepoName(raw);
    if (!norm.ok) return { ok: false as const, reason: "invalid" as const, error: norm.error };
    return {
      ok: true as const,
      name: norm.name,
      original: norm.name !== raw ? raw : null,
    };
  }, [newRepoUrl]);
  const newRepoCanSubmit =
    newRepoPreview.ok &&
    newRepoBranch.trim() !== "" &&
    !repoAdd.submitting;

  if (!open) return null;

  async function save() {
    setStatus("saving");
    setError(null);
    try {
      // Send user as null when both fields are blank — that's
      // the explicit "clear identity" signal the API accepts.
      // Otherwise send the trimmed strings.
      const trimmedEmail = userEmail.trim();
      const trimmedName = userDisplayName.trim();
      const userPayload = trimmedEmail || trimmedName
        ? { email: trimmedEmail, displayName: trimmedName }
        : null;

      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openspecDir: path.trim(),
          mode,
          defaultBranch: defaultBranch.trim(),
          developerScanIntervalMinutes: developerScanInterval,
          remoteScanIntervalMinutes: remoteScanInterval,
          uekExpertScanIntervalMinutes: uekScanInterval,
          user: userPayload,
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
      setInitialRemoteScanInterval(
        data.remoteScanIntervalMinutes ?? remoteScanInterval,
      );
      setInitialUekScanInterval(
        data.uekExpertScanIntervalMinutes ?? uekScanInterval,
      );
      // Server normalises the user record; reflect whatever it
      // actually wrote back so the "Сохранить" button disables
      // correctly on the next open.
      const savedUser = data?.user ?? {};
      setInitialUserEmail(
        typeof savedUser.email === "string" ? savedUser.email : "",
      );
      setInitialUserDisplayName(
        typeof savedUser.displayName === "string" ? savedUser.displayName : "",
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
    setRemovingName(name);
    setRemoveError(null);
    try {
      const res = await fetch(
        `/api/repos/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRemoveError(data.error ?? `HTTP ${res.status}`);
        setRemovingName(null);
        return;
      }
      const next = { ...repos };
      delete next[name];
      setRepos(next);
      setInitialRepos(next);
      setRemovingName(null);
      setRemoveError(null);
      router.refresh();
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : String(e));
      setRemovingName(null);
    }
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
    developerScanInterval !== initialDeveloperScanInterval ||
    remoteScanInterval !== initialRemoteScanInterval ||
    uekScanInterval !== initialUekScanInterval ||
    userEmail !== initialUserEmail ||
    userDisplayName !== initialUserDisplayName;

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
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg border border-border bg-white shadow-cardHover"
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

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-slate-800">
              Режим доски
            </span>
            {mode === "developer" && (
              <div
                role="note"
                className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800"
              >
                Режим «Разработчик» сейчас в активной разработке: часть
                сценариев работает нестабильно, возможны ошибки в интерфейсе и
                незавершённые этапы.
              </div>
            )}
            <div
              role="radiogroup"
              aria-label="Режим доски"
              className="flex flex-col gap-1.5 rounded-md border border-border bg-slate-50 p-1"
            >
              <div className="flex gap-1">
                {(["developer", "analyst"] as const).map((modeId) => {
                  const m = MODES[modeId];
                  const active = mode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setMode(m.id)}
                      className={`relative flex flex-1 items-center justify-center gap-1.5 rounded px-2.5 py-1 text-[12px] font-medium transition ${
                        active
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      <span>{m.label}</span>
                      {m.id === "developer" && (
                        <span
                          className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700"
                          title="Режим дорабатывается"
                        >
                          in progress
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {(() => {
                const m = MODES["uek-expert"];
                const active = mode === m.id;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setMode(m.id)}
                    className={`flex w-full items-center justify-center gap-1.5 rounded px-2.5 py-1 text-[12px] font-medium transition ${
                      active
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    <span>{m.label}</span>
                  </button>
                );
              })()}
            </div>
            <span className="text-[11px] text-slate-500">
              «Разработчик» — 7 этапов реализации (бэклог → готово). «Аналитик» —
              5 этапов подготовки change-proposal (намерение → готово). Задачи
              отображаются только если их stage входит в выбранный режим.
            </span>
          </div>

          {mode !== "uek-expert" && (
            <>
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

          {/* Analyst-mode remote scan cadence. Only shown in
              analyst mode (like the developer interval above is
              shown only in developer mode). The 5-min default
              matches `DEFAULT_REMOTE_SCAN_MINUTES` in
              lib/watcher.ts; 0 disables background scanning. */}
          {mode === "analyst" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-slate-800">
                Сканирование веток коллег (мин)
              </span>
              <input
                type="number"
                min={0}
                max={1440}
                value={remoteScanInterval}
                onChange={(e) =>
                  setRemoteScanInterval(
                    Math.max(0, Number(e.target.value) || 0),
                  )
                }
                placeholder="5"
                className="h-8 w-32 rounded-md border border-border bg-white px-2 font-mono text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
              <span className="text-[11px] text-slate-500">
                Каждые N минут watcher просматривает{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
                  origin/feature/*
                </code>{" "}
                и показывает proposal'ы, опубликованные другими
                пользователями (только чтение).{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
                  0
                </code>{" "}
                — отключить (появятся только по кнопке ↻).
              </span>
            </label>
          )}

          {/* Identity — who am I in the multi-user model. The
              email is what we compare against `publishedBy.email`
              on remote tasks to decide "мои / чужие". Auto-filled
              from `git config user.email` on first open via
              /api/config/git-identity; the user can override. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-slate-800">
              Идентификация
            </span>
            <input
              type="text"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder="user@company.com"
              autoComplete="off"
              className="h-8 rounded-md border border-border bg-white px-2 font-mono text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            <input
              type="text"
              value={userDisplayName}
              onChange={(e) => setUserDisplayName(e.target.value)}
              placeholder={gitIdentityHint?.name ?? "Имя (необязательно)"}
              autoComplete="off"
              className="h-8 rounded-md border border-border bg-white px-2 font-mono text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            {gitIdentityHint && (
              <span className="text-[11px] text-slate-500">
                {gitIdentityHint.source === "repo"
                  ? "Автоматически из repo-конфига:"
                  : gitIdentityHint.source === "global"
                    ? "Автоматически из global git config:"
                    : "Git не ответил"}{" "}
                {gitIdentityHint.email && (
                  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                    {gitIdentityHint.email}
                  </code>
                )}
              </span>
            )}
            <span className="text-[11px] text-slate-500">
              По этому email задачи других пользователей помечаются
              как «от коллеги» на доске. Не влияет на автора коммитов
              — git использует ваш обычный конфиг.
            </span>
          </div>

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
                      disabled={removingName === name}
                      title="Удалить репозиторий"
                      aria-label={`Удалить репозиторий ${name}`}
                      aria-busy={removingName === name}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-slate-500"
                    >
                      {removingName === name ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
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
                  {newRepoPreview.ok ? (
                    <>
                      Имя:{" "}
                      <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                        {newRepoPreview.name}
                      </code>
                      {newRepoPreview.original && (
                        <span className="ml-1.5 text-slate-400">
                          (из{" "}
                          <code className="font-mono text-[10px]">
                            {newRepoPreview.original}
                          </code>
                          )
                        </span>
                      )}
                    </>
                  ) : newRepoPreview.reason === "missing" ? (
                    <>
                      Имя (из URL):{" "}
                      <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                        — не удалось извлечь —
                      </code>
                    </>
                  ) : (
                    <span className="text-red-700">{newRepoPreview.error}</span>
                  )}
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
                  disabled={!newRepoCanSubmit}
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

            {removeError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
                Не удалось удалить репозиторий: {removeError}
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
            </>
          )}

          {/* UEK-expert mode scan cadence. Drives the bitbucket
              MCP polling through gigacode (see
              lib/uek-expert/scanner.ts). 0 disables background
              polling; the manual "Обновить" button still works
              either way. Placed outside the developer/analyst
              block above because that block narrows `mode` and
              would make this branch appear unreachable. */}
          {mode === "uek-expert" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-slate-800">
                Интервал сканирования bitbucket (мин)
              </span>
              <input
                type="number"
                min={0}
                max={1440}
                value={uekScanInterval}
                onChange={(e) =>
                  setUekScanInterval(
                    Math.max(0, Number(e.target.value) || 0),
                  )
                }
                placeholder="5"
                className="h-8 w-32 rounded-md border border-border bg-white px-2 font-mono text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
              <span className="text-[11px] text-slate-500">
                Каждые N минут watcher запрашивает у bitbucket-mcp
                список ПР, где вы назначены ревьювером.{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
                  0
                </code>{" "}
                — отключить (список обновится только по кнопке
                «Обновить»).
              </span>
            </label>
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