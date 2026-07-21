import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  FolderOpen,
  Loader2,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { readConfig } from "@/lib/config";
import { readState } from "@/lib/state";
import {
  listChangeTree,
  formatBytes,
  type TreeNode,
} from "@/lib/openspec";
import { isProcessAlive } from "@/lib/process";
import { triggerContinueIfNeeded } from "@/lib/continuation";
import { FileTree } from "@/components/FileTree";
import { CopyPathButton } from "@/components/CopyPathButton";
import { StartForm } from "@/components/StartForm";

export default async function ChangePage({
  params,
}: {
  params: { name: string };
}) {
  const config = await readConfig();
  const openspecDir = config.openspecDir;
  if (!openspecDir) notFound();

  // Auto-trigger /opsx-continue for any proposal-stage task ready for it
  // (fires when user opens a detail page, not only on explicit Refresh).
  await triggerContinueIfNeeded(openspecDir);

  const state = await readState();
  const task = state.tasks[params.name];
  if (!task) notFound();

  const changePath = `${openspecDir}/changes/${params.name}`;
  const tree = await listChangeTree(changePath);
  const folderExists = tree !== null;
  const fileCount = tree ? countFiles(tree) : 0;
  const totalSize = tree ? tree.size : 0;
  const lastScanned = new Date(task.lastScannedAt);
  const dateStr = lastScanned.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const relPath = `openspec/changes/${task.summary.changeName}`;

  const qwenAlive = task.qwenPid ? isProcessAlive(task.qwenPid) : false;
  const qwenContinueAlive = task.qwenContinuePid
    ? isProcessAlive(task.qwenContinuePid)
    : false;

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
              <span>·</span>
              <span>Обновлено {dateStr}</span>
              {task.qwenPid && (
                <>
                  <span>·</span>
                  <QwenBadge pid={task.qwenPid} alive={qwenAlive} />
                </>
              )}
            </div>
          </header>

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
            <FileTree root={tree!} changeName={task.summary.changeName} />
          ) : (
            <div className="rounded-md border border-dashed border-border bg-white px-4 py-6 text-center text-[12px] text-slate-500">
              Папка <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-mono">openspec/changes/{task.summary.changeName}</code> ещё не создана.
              {task.qwenPid && qwenAlive && (
                <> Подождите, пока qwen-процесс создаст файлы.</>
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

          {task.qwenPid && (
            <section className="mt-5 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600">
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                <QwenStatusIcon alive={qwenAlive} />
                <span>
                  qwen /opsx-new:{" "}
                  {!qwenAlive && task.qwenExitCode != null
                    ? task.qwenExitCode === 0
                      ? "завершён (exit 0)"
                      : `ошибка (exit ${task.qwenExitCode})`
                    : qwenAlive
                      ? "выполняется"
                      : "завершён"}
                </span>
              </div>
              {task.qwenStartedAt && (
                <div className="mt-1 text-[11px] text-slate-500">
                  Запущен: {new Date(task.qwenStartedAt).toLocaleString("ru-RU")}
                </div>
              )}
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-slate-500">PID</dt>
                <dd className="font-mono text-[10px]">{task.qwenPid}</dd>
                <dt className="text-slate-500">Команда</dt>
                <dd className="font-mono text-[10px] break-all">
                  {task.jiraUrl
                    ? `qwen -p "/opsx:plan ${task.openspecWorktreePath}/changes/${task.summary.changeName}"`
                    : `qwen -p "/opsx-new ${task.summary.title}"`}
                </dd>
                {task.qwenLogPath && (
                  <>
                    <dt className="text-slate-500">Лог</dt>
                    <dd className="font-mono text-[10px] break-all text-slate-500">
                      {task.qwenLogPath}
                    </dd>
                  </>
                )}
              </dl>
            </section>
          )}

          {task.qwenContinuePid && (
            <section className="mt-3 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600">
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                <QwenStatusIcon alive={qwenContinueAlive} />
                <span>
                  qwen /opsx-continue:{" "}
                  {!qwenContinueAlive && task.qwenContinueExitCode != null
                    ? task.qwenContinueExitCode === 0
                      ? "завершён (exit 0)"
                      : `ошибка (exit ${task.qwenContinueExitCode})`
                    : qwenContinueAlive
                      ? "выполняется"
                      : "завершён"}
                </span>
              </div>
              {task.qwenContinueStartedAt && (
                <div className="mt-1 text-[11px] text-slate-500">
                  Запущен:{" "}
                  {new Date(task.qwenContinueStartedAt).toLocaleString("ru-RU")}
                </div>
              )}
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-slate-500">PID</dt>
                <dd className="font-mono text-[10px]">{task.qwenContinuePid}</dd>
                <dt className="text-slate-500">Команда</dt>
                <dd className="font-mono text-[10px] break-all">
                  {`qwen -p "/opsx-continue ${openspecDir}/changes/${task.summary.changeName}"`}
                </dd>
                {task.qwenContinueLogPath && (
                  <>
                    <dt className="text-slate-500">Лог</dt>
                    <dd className="font-mono text-[10px] break-all text-slate-500">
                      {task.qwenContinueLogPath}
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
                  changeName={task.summary.changeName}
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
                  {new Date(task.startedAt).toLocaleString("ru-RU")}
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
                <dt className="text-slate-500">qwen PID</dt>
                <dd className="font-mono text-[10px]">
                  {task.qwenPid ?? "не запущен (qwen не в PATH?)"}
                </dd>
              </dl>
            </section>
          )}

          <div className="mt-3 flex gap-2">
            {folderExists && <OpenInFinderForm changeName={task.summary.changeName} />}
            <CopyPathButton path={relPath} />
          </div>
        </div>
      </div>
    </div>
  );
}

function QwenBadge({ pid, alive }: { pid: number; alive: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
        alive
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-600"
      }`}
      title={alive ? "qwen-процесс выполняется" : "qwen-процесс завершён"}
    >
      <QwenStatusIcon alive={alive} />
      <span>qwen · {pid}</span>
    </span>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function QwenStatusIcon({ alive }: { alive: boolean }) {
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

function OpenInFinderForm({ changeName }: { changeName: string }) {
  return (
    <form
      action={`/api/changes/${encodeURIComponent(changeName)}/open`}
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