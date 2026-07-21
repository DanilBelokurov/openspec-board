import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  FolderOpen,
  Loader2,
  CheckCircle2,
  CircleAlert,
  Hourglass,
  ExternalLink,
  CheckCheck,
  FolderPlus,
  type LucideIcon,
} from "lucide-react";
import { readConfig } from "@/lib/config";
import { readState } from "@/lib/state";
import {
  listChangeTree,
  formatBytes,
  checkProposalExists,
  type TreeNode,
} from "@/lib/openspec";
import { isProcessAlive } from "@/lib/process";
import { triggerContinueIfNeeded } from "@/lib/continuation";
import { extractJiraId } from "@/lib/jira";
import { formatDateTime } from "@/lib/format";
import { FileTree } from "@/components/FileTree";
import { CopyPathButton } from "@/components/CopyPathButton";
import { StartForm } from "@/components/StartForm";
import { ConfirmButton } from "@/components/ConfirmButton";

export default async function ChangePage({
  params,
}: {
  params: { tag: string };
}) {
  const config = await readConfig();
  const openspecDir = config.openspecDir;
  if (!openspecDir) notFound();

  // Auto-trigger /opsx-continue for any proposal-stage task ready for it
  // (fires when user opens a detail page, not only on explicit Refresh).
  await triggerContinueIfNeeded(openspecDir);

  const state = await readState();
  const task = state.tasks[params.tag];
  if (!task) notFound();

  const tag = task.summary.changeName;
  const changePath = `${openspecDir}/changes/${tag}`;
  const tree = await listChangeTree(changePath);
  const folderExists = tree !== null;
  const fileCount = tree ? countFiles(tree) : 0;
  const totalSize = tree ? tree.size : 0;
  const proposalReady = await checkProposalExists(changePath);
  const lastScanned = new Date(task.lastScannedAt);
  const dateStr = formatDateTime(task.lastScannedAt);
  const relPath = `openspec/changes/${tag}`;

  // Step 1 (analyst mode): `openspec new change <tag> --description <text>`.
  const openspecNewAlive = task.openspecNewPid
    ? isProcessAlive(task.openspecNewPid)
    : false;
  // Step 2 (analyst mode): gigacode /opsx-continue.
  const gigacodeContinueAlive = task.gigacodeContinuePid
    ? isProcessAlive(task.gigacodeContinuePid)
    : false;
  // Developer-mode "Start" step: gigacode /opsx:plan.
  const gigacodeAlive = task.gigacodePid
    ? isProcessAlive(task.gigacodePid)
    : false;
  const jiraId = task.jiraUrl
    ? extractJiraId(task.jiraUrl)
    : null;

  // "Подтверждено" button is shown when:
  //  - task is still in proposal stage (after click, stage → delta-spec)
  //  - proposal.md is on disk (proposalReady)
  //  - no CLI step error (otherwise user must fix first)
  const showConfirmButton =
    task.stage === "proposal" &&
    proposalReady &&
    !(
      (task.openspecNewExitCode != null && task.openspecNewExitCode !== 0) ||
      (task.gigacodeContinueExitCode != null &&
        task.gigacodeContinueExitCode !== 0)
    );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <div className="flex h-12 shrink-0 items-center border-b border-border bg-surface-raised px-4">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Назад к доске</span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-4xl px-8 py-6">
          <header className="mb-5">
            <h1 className="text-[20px] font-semibold leading-tight text-slate-900">
              {task.summary.title}
            </h1>
            <code className="mt-1 block text-[12px] text-slate-500">
              {relPath}
            </code>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                {task.id}
              </span>
              <span>·</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                {task.stage}
              </span>
              {jiraId && (
                <>
                  <span>·</span>
                  <a
                    href={task.jiraUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                    title={task.jiraUrl}
                  >
                    {jiraId}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </>
              )}
              <span>·</span>
              <span>Обновлено {dateStr}</span>
              {task.openspecNewPid && (
                <>
                  <span>·</span>
                  <ProcessBadge
                    pid={task.openspecNewPid}
                    alive={openspecNewAlive}
                    label="openspec new change"
                  />
                </>
              )}
              {task.gigacodeContinuePid && (
                <>
                  <span>·</span>
                  <ProcessBadge
                    pid={task.gigacodeContinuePid}
                    alive={gigacodeContinueAlive}
                    label="gigacode /opsx-continue"
                  />
                </>
              )}
            </div>
          </header>

          {showConfirmButton && (
            <section className="mb-5">
              <ConfirmButton
                tag={tag}
                taskTitle={task.summary.title}
              />
            </section>
          )}

          {task.description && (
            <section className="mb-5">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                Описание
              </h2>
              <div className="rounded-md border border-border bg-white px-4 py-3 text-[12px] leading-relaxed text-slate-700 whitespace-pre-wrap">
                {task.description}
              </div>
            </section>
          )}

          <section className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
            Структура
          </section>
          {folderExists ? (
            <FileTree root={tree!} tag={tag} />
          ) : (
            <div className="rounded-md border border-dashed border-border bg-white px-4 py-6 text-center text-[12px] text-slate-500">
              Папка <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-mono">openspec/changes/{tag}</code> ещё не создана.
              {task.openspecNewPid && openspecNewAlive && (
                <> Подождите, пока openspec new change создаст файлы.</>
              )}
            </div>
          )}

          <div className="mt-5 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600">
            <span className="font-semibold text-slate-800">
              {fileCount} {pluralFiles(fileCount)}
            </span>
            <span className="text-slate-400"> · </span>
            <span>{formatBytes(totalSize)}</span>
            <span className="text-slate-400"> · </span>
            <span>
              {task.summary.newCapabilities.length} new,{" "}
              {task.summary.modifiedCapabilities.length} modified capabilities
            </span>
          </div>

          {/* First card (analyst mode, step 1): the openspec CLI that
              creates the change folder. */}
          {task.openspecNewPid && (
            <section className="mt-5 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600">
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                <ProcessStatusIcon alive={openspecNewAlive} />
                <span>
                  Создание директории change-proposal:{" "}
                  {!openspecNewAlive && task.openspecNewExitCode != null
                    ? task.openspecNewExitCode === 0
                      ? "завершено (exit 0)"
                      : `ошибка (exit ${task.openspecNewExitCode})`
                    : openspecNewAlive
                      ? "выполняется"
                      : "завершено"}
                </span>
              </div>
              {task.openspecNewStartedAt && (
                <div className="mt-1 text-[11px] text-slate-500">
                  Запущено:{" "}
                  {formatDateTime(task.openspecNewStartedAt)}
                </div>
              )}
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-slate-500">PID</dt>
                <dd className="font-mono text-[10px]">{task.openspecNewPid}</dd>
                <dt className="text-slate-500">Команда</dt>
                <dd className="font-mono text-[10px] break-all">
                  {`openspec new change ${tag}${task.description ? ` --description "${task.description.replace(/"/g, '\\"').replace(/\n/g, " ")}"` : ""}`}
                </dd>
                {task.openspecNewLogPath && (
                  <>
                    <dt className="text-slate-500">Лог</dt>
                    <dd className="font-mono text-[10px] break-all text-slate-500">
                      {task.openspecNewLogPath}
                    </dd>
                  </>
                )}
              </dl>
            </section>
          )}

          {task.gigacodeContinuePid && (
            <section className="mt-3 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600">
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                <ProcessStatusIcon alive={gigacodeContinueAlive} />
                <span>
                  Создание proposal.md:{" "}
                  {!gigacodeContinueAlive && task.gigacodeContinueExitCode != null
                    ? task.gigacodeContinueExitCode === 0
                      ? "завершено (exit 0)"
                      : `ошибка (exit ${task.gigacodeContinueExitCode})`
                    : gigacodeContinueAlive
                      ? "выполняется"
                      : "завершено"}
                </span>
              </div>
              {task.gigacodeContinueStartedAt && (
                <div className="mt-1 text-[11px] text-slate-500">
                  Запущено: {formatDateTime(task.gigacodeContinueStartedAt)}
                </div>
              )}
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-slate-500">PID</dt>
                <dd className="font-mono text-[10px]">{task.gigacodeContinuePid}</dd>
                <dt className="text-slate-500">Команда</dt>
                <dd className="font-mono text-[10px] break-all">
                  {`gigacode --approval-mode=auto-edit --add-dir ${openspecDir} -p "/opsx-continue ${(task.description ?? "").replace(/\n/g, " ")}"`}
                </dd>
                {task.gigacodeContinueLogPath && (
                  <>
                    <dt className="text-slate-500">Лог</dt>
                    <dd className="font-mono text-[10px] break-all text-slate-500">
                      {task.gigacodeContinueLogPath}
                    </dd>
                  </>
                )}
              </dl>
            </section>
          )}

          {task.stage === "backlog" && (
            <section className="mt-5">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                Начать работу
              </h2>
              <div className="rounded-md border border-border bg-white px-4 py-3">
                <StartForm
                  tag={tag}
                  initialJiraUrl={task.jiraUrl}
                  initialCodeRepoPath={task.codeRepoPath}
                />
              </div>
            </section>
          )}

          {task.stage !== "backlog" && task.jiraUrl && (
            <section className="mt-5 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600">
              <div className="font-semibold text-slate-800">Запущено</div>
              {task.startedAt && (
                <div className="mt-1 text-[11px] text-slate-500">
                  {formatDateTime(task.startedAt)}
                </div>
              )}
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                {task.openspecWorktreePath && (
                  <>
                    <dt className="text-slate-500">Openspec worktree</dt>
                    <dd className="font-mono text-[10px] break-all">
                      {task.openspecWorktreePath}
                    </dd>
                  </>
                )}
                {task.codeWorktreePath && (
                  <>
                    <dt className="text-slate-500">Code worktree</dt>
                    <dd className="font-mono text-[10px] break-all">
                      {task.codeWorktreePath}
                    </dd>
                  </>
                )}
                <dt className="text-slate-500">gigacode PID</dt>
                <dd className="font-mono text-[10px]">
                  {task.gigacodePid ?? "не запущен (gigacode не в PATH?)"}
                </dd>
              </dl>
            </section>
          )}

          <div className="mt-3 flex gap-2">
            {folderExists && (
              <OpenInFinderForm tag={tag} />
            )}
            <CopyPathButton path={relPath} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProcessBadge({
  pid,
  alive,
  label,
}: {
  pid: number;
  alive: boolean;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
        alive
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-600"
      }`}
      title={alive ? "процесс выполняется" : "процесс завершён"}
    >
      <ProcessStatusIcon alive={alive} />
      <span>
        {label} · {pid}
      </span>
    </span>
  );
}

function ProcessStatusIcon({ alive }: { alive: boolean }) {
  const Icon: LucideIcon = alive ? Loader2 : CheckCircle2;
  return <Icon className={`h-2.5 w-2.5 ${alive ? "animate-spin" : ""}`} />;
}

function countFiles(node: TreeNode): number {
  if (node.type === "file") return 1;
  if (!node.children) return 0;
  return node.children.reduce((sum, c) => sum + countFiles(c), 0);
}

function pluralFiles(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "файл";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "файла";
  return "файлов";
}

function OpenInFinderForm({ tag }: { tag: string }) {
  return (
    <form
      action={`/api/changes/${encodeURIComponent(tag)}/open`}
      method="post"
    >
      <button
        type="submit"
        className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        <span>Открыть в Finder</span>
      </button>
    </form>
  );
}
