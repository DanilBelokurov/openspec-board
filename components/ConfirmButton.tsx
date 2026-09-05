"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCheck,
  Loader2,
  Pencil,
  X,
  Send,
} from "lucide-react";
import { ReopenTaskDialog } from "./ReopenTaskDialog";

/**
 * Interval (ms) between stage-status polls after a successful
 * confirm. The cascade gigacode spawn usually writes its
 * artifact within 10-30s, so 1.5s gives ~7 polls inside the
 * expected window without hammering the dev server. The same
 * cadence is used by `DoneDeploymentActions` for push/PR
 * polling, so the perceived latency is consistent across the
 * page.
 */
const POLL_INTERVAL_MS = 1500;
/**
 * Hard ceiling on the polling loop. After this many ms we
 * stop polling and route to the board anyway — better to show
 * the user a slightly stale board than to leave them stuck on
 * the detail page if the cascade subprocess gets stuck for any
 * reason (e.g. a slow LLM provider).
 */
const POLL_TIMEOUT_MS = 180_000;

type StageStatus = {
  stage: string;
  ready: boolean;
  error: boolean;
  pipelineRunning: boolean;
  hasCascade: boolean;
};

interface ConfirmArtifactButtonProps {
  tag: string;
  stage: "proposal" | "delta-spec" | "design" | "adr" | "plan";
  title: string;
  artifactLabel: string;
  artifactHint: string;
}

/**
 * Resolve the analyst-mode stage that follows the one being
 * confirmed. Mirrors the NEXT_STAGE table in
 * `app/api/changes/[tag]/confirm/route.ts`; kept local so the
 * spinner label ("Готовим Дельта-спецификация…") has something
 * meaningful to show even when the confirm response didn't
 * carry a `cascade` block (e.g. cascade ended naturally).
 */
function inferNextStage(
  stage: "proposal" | "delta-spec" | "design" | "adr" | "plan",
): string | null {
  switch (stage) {
    case "proposal":
      return "delta-spec";
    case "delta-spec":
      return "design";
    case "design":
      return "adr";
    case "adr":
      return "done";
    case "plan":
      // Developer-mode plan→develop is a different shape
      // (multi-service child creation) and doesn't have a
      // "ready" signal the same way. The board will reflect
      // the new state on the next manual refresh, so we just
      // navigate.
      return null;
  }
}

/** Human-readable label for a stage id, used in the polling
 *  spinner message. Localised to Russian to match the rest
 *  of the UI.
 */
function stageLabel(stage: string): string {
  switch (stage) {
    case "proposal":
      return "Proposal";
    case "delta-spec":
      return "Дельта-спецификация";
    case "design":
      return "Дизайн";
    case "adr":
      return "ADR";
    case "done":
      return "Готово";
    default:
      return stage;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Two-mode card: (1) green check + "Подтверждено" advances the task
 * to the next analyst-mode stage; (2) pencil reveals an inline
 * textarea where the analyst can request changes to the generated
 * artifact. The pencil posts to a stage-specific update endpoint
 * (update-proposal / update-delta-spec), which re-runs gigacode
 * --prompt with the user's request folded in.
 *
 * On a successful confirm we router.push("/") so the analyst lands
 * back on the board and sees the task in its new column.
 *
 * Plus a "Редактировать этап…" link (visible only on analyst
 * stages with at least one earlier stage to revert to — i.e.
 * delta-spec / design / adr, NOT proposal or plan). It opens the
 * ReopenTaskDialog, which arms a cascade: every stage from the
 * chosen target up to the current one will be re-written with the
 * user's comment. The same mechanism is wired to the done-stage
 * "Редактировать" button in DoneTaskActions — UI is identical
 * regardless of whether the user reverts from done or from a
 * non-done analyst stage.
 */
export function ConfirmArtifactButton({
  tag,
  stage,
  title,
  artifactLabel,
  artifactHint,
}: ConfirmArtifactButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [updating, setUpdating] = useState(false);

  const [reopenOpen, setReopenOpen] = useState(false);

  // Set while we wait for the next stage's artifact to appear on
  // disk after a successful confirm. Mirrors the polling loop in
  // `handleClick` — the button is replaced with a spinner until
  // either the cascade finishes (we navigate to "/"), or the
  // server reports an error (we stop polling and let the user
  // see the existing error block on the detail page).
  const [awaitingNext, setAwaitingNext] = useState(false);
  // Holds the cascade target stage for the message under the
  // spinner ("Готовим Дельта-спецификация…"). Defaults to the
  // next stage in line so the spinner is meaningful even when
  // the cascade response didn't include a `cascade` block
  // (which happens when the cascade ended naturally — see the
  // `commentCleared` branch in confirm/route.ts).
  const [awaitingStage, setAwaitingStage] = useState<string | null>(null);
  // Cancels the polling loop from inside `pollOnce` when
  // `setState` causes a re-render mid-flight. Necessary
  // because the awaited fetch can resolve AFTER the user has
  // already navigated away.
  const pollCancelledRef = useRef(false);

  // The "Редактировать этап…" button only makes sense when the
  // analyst can revert to an earlier stage. Proposal is the first
  // analyst stage — nothing earlier. Plan is a developer-mode
  // stage — no cascade there.
  const canRevert =
    stage === "delta-spec" || stage === "design" || stage === "adr";

  function openEditor() {
    setEditing(true);
    setEditValue("");
    setError(null);
  }

  function cancelEdit() {
    setEditing(false);
    setEditValue("");
  }

  async function submitEdit() {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/update-${stage}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comments: trimmed }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Collapse the editor; the artifact-update pipeline runs in
      // the background and writes the updated files to the
      // worktree. router.refresh() makes the new file content show
      // up immediately in the file tree on the detail page.
      setEditing(false);
      setEditValue("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdating(false);
    }
  }

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/confirm`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // The confirm endpoint already advanced the task to the
      // next stage in state.json. If the server returned
      // `cascade.active`, the artifact for the next stage is
      // being written in the background by a detached gigacode
      // subprocess — we need to wait for that before the board
      // will reflect the new stage in the "ready" column. Either
      // way (cascade or not), spin a short polling loop so the
      // user lands on the board the moment the next artifact
      // exists, instead of waiting for the next manual refresh.
      const cascadeActive = Boolean(data?.cascade?.active);
      const nextStage = cascadeActive
        ? data.cascade.targetStage
        : inferNextStage(stage);
      await waitForNextStageAndNavigate(nextStage);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Poll the stage-status endpoint until the server reports
   * `ready: true` for the next stage, then navigate to the
   * board. If the server reports an error, stop polling and
   * stay on the detail page so the user can read the error
   * block. If we hit the hard timeout, navigate to the board
   * anyway — a stale board is better than being stuck.
   */
  async function waitForNextStageAndNavigate(nextStage: string | null) {
    if (!nextStage || nextStage === "done") {
      // No next artifact to wait for — go straight to the
      // board. This is the "Confirm adr" → done transition:
      // confirm/route.ts clears cascade fields and the task
      // lands in `done` immediately, with nothing on disk to
      // race against.
      router.push("/");
      return;
    }
    setAwaitingNext(true);
    setAwaitingStage(nextStage);
    pollCancelledRef.current = false;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    try {
      while (!pollCancelledRef.current && Date.now() < deadline) {
        const status = await pollOnce(nextStage);
        if (pollCancelledRef.current) return;
        if (status?.error) {
          // Surface the failure inline and stay on the
          // detail page. The error block under the button
          // is the same shape as a failed confirm — the
          // user sees what went wrong.
          setError(
            `Не удалось подготовить следующий этап (${nextStage}) — проверьте логи`,
          );
          setAwaitingNext(false);
          setAwaitingStage(null);
          return;
        }
        if (status?.ready) {
          router.push("/");
          return;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      // Timeout reached: drop the user on the board anyway.
      // The board will show whatever state is current — if
      // the cascade is still running, the card sits in the
      // new column with `ready=false` and the user can
      // refresh manually.
      router.push("/");
    } finally {
      setAwaitingNext(false);
      setAwaitingStage(null);
    }
  }

  async function pollOnce(_expectedStage: string): Promise<StageStatus | null> {
    try {
      const res = await fetch(
        `/api/changes/${encodeURIComponent(tag)}/stage-status`,
        { cache: "no-store" },
      );
      if (!res.ok) return null;
      return (await res.json()) as StageStatus;
    } catch {
      // Transient network error — let the next tick retry.
      return null;
    }
  }

  // Cancel any in-flight poll when the component unmounts
  // (e.g. the user clicks the breadcrumb back-link while
  // we're still waiting on a fetch). The race we're guarding
  // against: the awaited fetch resolves AFTER router.push
  // already unmounted this component, at which point
  // setState would log a React warning.
  useEffect(() => {
    return () => {
      pollCancelledRef.current = true;
    };
  }, []);

  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-900">
      <div className="flex items-center gap-3">
        <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
        <div className="flex-1">
          <div className="font-semibold">{title}</div>
          <div className="mt-0.5 text-[11px] text-emerald-800/80">
            Файл <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[10px]">{artifactLabel}</code> создан в{" "}
            <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[10px]">
              {tag}
            </code>
            . {artifactHint}
          </div>
        </div>
        {!editing && !awaitingNext && (
          <button
            type="button"
            onClick={openEditor}
            title="Запросить изменения к текущему этапу"
            aria-label="Запросить изменения"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={handleClick}
          disabled={submitting || editing || awaitingNext}
          className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting || awaitingNext ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCheck className="h-3.5 w-3.5" />
          )}
          <span>
            {awaitingNext
              ? "Готовим следующий этап…"
              : submitting
                ? "Подтверждение…"
                : "Подтверждено"}
          </span>
        </button>
        {canRevert && !editing && !awaitingNext && (
          <button
            type="button"
            onClick={() => setReopenOpen(true)}
            title="Вернуть задачу на более ранний этап с переписыванием всех последующих артефактов каскадом"
            aria-label="Редактировать этап"
            className="flex h-8 items-center gap-1.5 rounded-md bg-amber-500 px-3 text-[12px] font-medium text-white hover:bg-amber-600"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>Редактировать</span>
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-3 space-y-2 border-t border-emerald-200/70 pt-3">
          <label
            htmlFor={`artifact-edit-${stage}-${tag}`}
            className="block text-[11px] font-medium text-emerald-900/80"
          >
            Что изменить?
          </label>
          <textarea
            id={`artifact-edit-${stage}-${tag}`}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={
              stage === "proposal"
                ? "Например: «добавь раздел про риски», «уточни scope», «опиши как мы будем мерять успех»"
                : stage === "delta-spec"
                  ? "Например: «добавь требование про логирование», «уточни WHEN/THEN у сценария X», «убери лишнее требование»"
                  : stage === "design"
                    ? "Например: «опиши альтернативу Y подробнее», «добавь диаграмму последовательности», «убери избыточное обсуждение Z»"
                    : "Например: «уточни статус предложения (принято/отклонено)», «добавь рассмотрение альтернатив», «усиль раздел с последствиями»"
            }
            rows={3}
            autoFocus
            disabled={updating}
            className="w-full rounded-md border border-emerald-300 bg-white px-2 py-1.5 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-300 disabled:bg-slate-50"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={updating}
              className="flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              <span>Отмена</span>
            </button>
            <button
              type="button"
              onClick={submitEdit}
              disabled={updating || editValue.trim().length === 0}
              className="flex h-7 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {updating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>Отправить</span>
            </button>
          </div>
        </div>
      )}

      {awaitingNext && awaitingStage && awaitingStage !== "done" && (
        <div className="mt-2 flex items-center gap-2 rounded border border-emerald-200/70 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-800">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span>
            Готовим <strong>{stageLabel(awaitingStage)}</strong> — перейдём на
            доску автоматически.
          </span>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {error}
        </div>
      )}

      {canRevert && (
        <ReopenTaskDialog
          open={reopenOpen}
          tag={tag}
          fromStage={stage}
          onClose={() => setReopenOpen(false)}
        />
      )}
    </div>
  );
}