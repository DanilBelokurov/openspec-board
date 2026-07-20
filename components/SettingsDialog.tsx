"use client";

import { useEffect, useRef, useState } from "react";
import { X, FolderSearch } from "lucide-react";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type Status = "idle" | "saving" | "saved" | "error";

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [path, setPath] = useState("");
  const [initialPath, setInitialPath] = useState("");
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStatus("idle");
    setError(null);
    setPickedName(null);
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        const v = data?.openspecDir ?? "";
        setPath(v);
        setInitialPath(v);
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
        body: JSON.stringify({ openspecDir: path.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setInitialPath(data.openspecDir ?? "");
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
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

  const dirty = path !== initialPath;

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