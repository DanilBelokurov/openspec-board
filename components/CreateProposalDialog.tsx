"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, FilePlus, Loader2, HelpCircle } from "lucide-react";
import { isValidOpenspecTag } from "@/lib/tag";
import { extractJiraId } from "@/lib/jira";

interface CreateProposalDialogProps {
  open: boolean;
  onClose: () => void;
}

type Status = "idle" | "saving" | "saved" | "error";

export function CreateProposalDialog({ open, onClose }: CreateProposalDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tag, setTag] = useState("");
  const [jiraUrl, setJiraUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus("idle");
    setError(null);
    setTitle("");
    setDescription("");
    setTag("");
    setJiraUrl("");
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

  // Tag rules match the shared `lib/tag.ts` validator used by the server
  // (single source of truth for both UI gating and API gating).
  const tagValid = isValidOpenspecTag(tag.trim());
  // jiraUrl is required — must look like a Jira URL or ticket id from which
  // we can extract a ticket id. We re-check on the server too.
  const jiraId = jiraUrl.trim() ? extractJiraId(jiraUrl.trim()) : null;
  const canSubmit =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    tagValid &&
    jiraId != null &&
    status !== "saving";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          tag: tag.trim(),
          jiraUrl: jiraUrl.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setStatus("error");
        return;
      }
      setStatus("saved");
      router.refresh();
      setTimeout(() => {
        onClose();
      }, 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-proposal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-white shadow-cardHover"
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2
            id="new-proposal-title"
            className="flex items-center gap-2 text-[14px] font-semibold text-slate-900"
          >
            <FilePlus className="h-3.5 w-3.5" />
            Новый proposal
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-3 px-4 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-slate-800">
              Название
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Добавить авторизацию через OAuth2"
              autoFocus
              className="h-8 rounded-md border border-border bg-white px-2 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <span className="text-[12px] font-medium text-slate-800">
                Tag
              </span>
              <span
                title="Lowercase kebab-case (как у `openspec new change`): строчные латинские буквы, цифры и одиночные дефисы, начинается с буквы, без двойных дефисов"
                className="cursor-help"
              >
                <HelpCircle className="h-3 w-3 text-slate-400" />
              </span>
            </div>
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="add-oauth2-auth"
              required
              className="h-8 rounded-md border border-border bg-white px-2 font-mono text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            <span className="text-[11px] text-slate-500">
              Уникальный идентификатор change-proposal
            </span>
            {tag.length > 0 && !tagValid && (
              <span className="text-[11px] text-red-600">
                Неверный формат: lowercase kebab-case (строчные латинские буквы/цифры/одиночные дефисы, начинается с буквы, без двойных дефисов, 1-40 символов).
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-slate-800">
              Краткое описание
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Зачем это нужно, какую проблему решает, какие компоненты затронуты"
              rows={5}
              className="rounded-md border border-border bg-white px-2 py-1.5 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-slate-800">
              Ссылка на Jira
            </span>
            <input
              type="text"
              value={jiraUrl}
              onChange={(e) => setJiraUrl(e.target.value)}
              placeholder="https://company.atlassian.net/browse/ENG-123"
              className="h-8 rounded-md border border-border bg-white px-2 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            <span className="text-[11px] text-slate-500">
              На карточке и в заголовке задачи появится бейдж Jira-id.
            </span>
            {jiraUrl.trim().length > 0 && jiraId == null && (
              <span className="text-[11px] text-red-600">
                Не удалось извлечь Jira ticket id из ссылки.
              </span>
            )}
          </label>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
              {error}
            </div>
          )}
          {status === "saved" && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
              Создано. Команда `openspec new change` запущена.
            </div>
          )}

          <footer className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-7 rounded-md border border-border bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex h-7 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {status === "saving" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              <span>Создать</span>
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}