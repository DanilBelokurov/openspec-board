import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import { readConfig } from "@/lib/config";
import { readState } from "@/lib/state";
import {
  listChangeTree,
  formatBytes,
  checkProposalExists,
  resolveProposalRootForTask,
  type TreeNode,
} from "@/lib/openspec";
import { isProcessAlive } from "@/lib/process";
import { triggerContinueIfNeeded, isStageReady } from "@/lib/continuation";
import { extractJiraId } from "@/lib/jira";
import { formatDateTime } from "@/lib/format";
import { FileTree } from "@/components/FileTree";
import { CopyPathButton } from "@/components/CopyPathButton";
import { OpenInFinderForm } from "@/components/OpenInFinderForm";
import { StartForm } from "@/components/StartForm";
import { ConfirmArtifactButton } from "@/components/ConfirmButton";
import { TaskActions } from "@/components/TaskActions";
import { DoneTaskActions } from "@/components/DoneTaskActions";
import { DoneDeploymentActions } from "@/components/DoneDeploymentActions";

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
  const proposalRoot = await resolveProposalRootForTask(task, openspecDir);
  const changePath = `${proposalRoot}/openspec/changes/${tag}`;
  const tree = await listChangeTree(changePath);
  const folderExists = tree !== null;
  const fileCount = tree ? countFiles(tree) : 0;
  const totalSize = tree ? tree.size : 0;
  const proposalReady = await checkProposalExists(changePath);
  // delta-spec is "ready" when the specs/ directory exists and
  // contains at least one .md file (mirrors isStageReady for the
  // delta-spec stage).
  let deltaSpecReady = false;
  if (task.stage === "delta-spec" && proposalRoot) {
    deltaSpecReady = await isStageReady(proposalRoot, tag, {
      stage: "delta-spec",
      instructionsArtifact: "specs",
      artifactSubpath: "specs",
    });
  }
  // design is "ready" when design.md exists at the change folder
  // root.
  let designReady = false;
  if (task.stage === "design" && proposalRoot) {
    designReady = await isStageReady(proposalRoot, tag, {
      stage: "design",
      instructionsArtifact: "design",
      artifactSubpath: "design.md",
    });
  }
  // adr is "ready" when adr.md exists at the change folder root.
  let adrReady = false;
  if (task.stage === "adr" && proposalRoot) {
    adrReady = await isStageReady(proposalRoot, tag, {
      stage: "adr",
      instructionsArtifact: "adr",
      artifactSubpath: "adr.md",
    });
  }
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
  // Step 2b (analyst mode): proposal-update gigacode re-run, triggered
  // by the pencil button on ConfirmArtifactButton. Independent from
  // gigacodeContinuePid (a separate spawn).
  const proposalUpdateAlive = task.proposalUpdatePid
    ? isProcessAlive(task.proposalUpdatePid)
    : false;
  // delta-spec step PIDs — both create (auto-triggered when the
  // task moves into delta-spec) and update (pencil button on the
  // delta-spec ConfirmArtifactButton).
  const deltaSpecCreateAlive = task.deltaSpecCreatePid
    ? isProcessAlive(task.deltaSpecCreatePid)
    : false;
  const deltaSpecUpdateAlive = task.deltaSpecUpdatePid
    ? isProcessAlive(task.deltaSpecUpdatePid)
    : false;
  // design step PIDs — same shape as the delta-spec ones.
  const designCreateAlive = task.designCreatePid
    ? isProcessAlive(task.designCreatePid)
    : false;
  const designUpdateAlive = task.designUpdatePid
    ? isProcessAlive(task.designUpdatePid)
    : false;
  // adr step PIDs — same shape.
  const adrCreateAlive = task.adrCreatePid
    ? isProcessAlive(task.adrCreatePid)
    : false;
  const adrUpdateAlive = task.adrUpdatePid
    ? isProcessAlive(task.adrUpdatePid)
    : false;
  const jiraId = task.jiraUrl
    ? extractJiraId(task.jiraUrl)
    : null;

  // "Подтверждено" button is shown when the artifact for the current
// stage is ready and no CLI step in this stage has failed. proposal
// checks openspecNew + gigacodeContinue; delta-spec checks the
// delta-spec create run.
  const currentStageError =
    task.stage === "proposal"
      ? (task.openspecNewExitCode != null && task.openspecNewExitCode !== 0) ||
        (task.gigacodeContinueExitCode != null &&
          task.gigacodeContinueExitCode !== 0)
      : task.stage === "delta-spec"
        ? task.deltaSpecCreateExitCode != null &&
          task.deltaSpecCreateExitCode !== 0
        : task.stage === "design"
          ? task.designCreateExitCode != null &&
            task.designCreateExitCode !== 0
          : task.stage === "adr"
            ? task.adrCreateExitCode != null &&
              task.adrCreateExitCode !== 0
            : false;
  // "Ready" only counts when no create-step process is still alive
  // — otherwise the artifact file might exist on disk but be only
  // partially written by the running gigacode process, and the
  // "Ready" only counts when no background sub-step is still
  // alive — otherwise the user would click "Подтверждаю" against
  // an artefact that gigacode is still writing. We gate on BOTH
  // the create-step (proposal / delta-spec / design / adr) AND
  // the update-step (the pencil button on ConfirmArtifactButton
  // spawns a separate gigacode process for the same stage that
  // also needs to finish before the artefact is safe to commit).
  const pipelineRunning =
    (task.stage === "proposal" &&
      ((task.openspecNewPid != null && isProcessAlive(task.openspecNewPid)) ||
        (task.gigacodeContinuePid != null &&
          isProcessAlive(task.gigacodeContinuePid)) ||
        (task.proposalUpdatePid != null &&
          isProcessAlive(task.proposalUpdatePid)))) ||
    (task.stage === "delta-spec" &&
      ((task.deltaSpecCreatePid != null &&
        isProcessAlive(task.deltaSpecCreatePid)) ||
        (task.deltaSpecUpdatePid != null &&
          isProcessAlive(task.deltaSpecUpdatePid)))) ||
    (task.stage === "design" &&
      ((task.designCreatePid != null &&
        isProcessAlive(task.designCreatePid)) ||
        (task.designUpdatePid != null &&
          isProcessAlive(task.designUpdatePid)))) ||
    (task.stage === "adr" &&
      ((task.adrCreatePid != null && isProcessAlive(task.adrCreatePid)) ||
        (task.adrUpdatePid != null &&
          isProcessAlive(task.adrUpdatePid))));
  const currentStageReady =
    !pipelineRunning &&
    (task.stage === "proposal"
      ? proposalReady
      : task.stage === "delta-spec"
        ? deltaSpecReady
        : task.stage === "design"
          ? designReady
          : task.stage === "adr"
            ? adrReady
            : false);
  const showConfirmButton = currentStageReady && !currentStageError;

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
            </div>
          </header>

          {task.archived && (
            <section className="mb-5 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-[12px] text-red-900">
              <div className="font-semibold">
                ⚠ Change-proposal архивирован upstream
              </div>
              <div className="mt-1 text-red-800/80">
                Задача остаётся на доске, потому что вы уже работаете
                над ней. Закройте её вручную, когда будете готовы.
              </div>
            </section>
          )}

          {task.codeBaseSha && task.mode === "developer" && (
            <section className="mb-5 flex items-center gap-2 rounded-md border border-border bg-white px-4 py-2 text-[12px] text-slate-700">
              <span className="text-slate-500">Commit в</span>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-800">
                {task.codeBranch ?? config.defaultBranch ?? "master"}
              </code>
              <span className="text-slate-500">:</span>
              <code
                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-800"
                title="SHA коммита, в котором change-proposal присутствует в tracked branch"
              >
                {task.codeBaseSha.slice(0, 12)}
              </code>
            </section>
          )}

          {showConfirmButton &&
            (task.stage === "proposal" ||
              task.stage === "delta-spec" ||
              task.stage === "design" ||
              task.stage === "adr") && (
              <section className="mb-5">
                <ConfirmArtifactButton
                  tag={tag}
                  stage={
                    task.stage as "proposal" | "delta-spec" | "design" | "adr"
                  }
                  title={
                    task.stage === "proposal"
                      ? "Proposal готов"
                      : task.stage === "delta-spec"
                        ? "Дельта-спецификация готова"
                        : task.stage === "design"
                          ? "Дизайн готов"
                          : "ADR готов"
                  }
                  artifactLabel={
                    task.stage === "proposal"
                      ? "proposal.md"
                      : task.stage === "delta-spec"
                        ? "specs/"
                        : task.stage === "design"
                          ? "design.md"
                          : "adr.md"
                  }
                  artifactHint="Подтвердите, чтобы перейти к следующему шагу."
                />
              </section>
            )}

          {task.stage === "done" && task.mode === "analyst" && (
            <section className="mb-5">
              <DoneDeploymentActions tag={tag} />
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
              creates the change folder. Per user spec: no PID/command/log,
              no "завершено (exit 0)" suffix. exit code 0 = success, only
              a non-zero exit code surfaces as an error. */}
          {task.openspecNewPid && (
            <details
              className="group mt-5 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center gap-2 font-semibold text-slate-800">
                <ProcessStatusIcon
                  alive={openspecNewAlive}
                  exitCode={task.openspecNewExitCode}
                />
                <span>Создание директории change-proposal</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                {task.openspecNewStartedAt && (
                  <div className="text-[11px] text-slate-500">
                    Запущено: {formatDateTime(task.openspecNewStartedAt)}
                  </div>
                )}
                {!openspecNewAlive &&
                  task.openspecNewExitCode != null &&
                  task.openspecNewExitCode !== 0 && (
                    <div className="text-[11px] text-red-700">
                      Ошибка (exit {task.openspecNewExitCode}) — см. лог
                    </div>
                  )}
              </div>
            </details>
          )}

          {task.gigacodeContinuePid && (
            <details
              className="group mt-3 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center gap-2 font-semibold text-slate-800">
                <ProcessStatusIcon
                  alive={gigacodeContinueAlive}
                  exitCode={task.gigacodeContinueExitCode}
                />
                <span>Создание proposal.md</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {task.gigacodeContinueStartedAt && (
                  <div className="text-[11px] text-slate-500">
                    Запущено: {formatDateTime(task.gigacodeContinueStartedAt)}
                  </div>
                )}
                {!gigacodeContinueAlive &&
                  task.gigacodeContinueExitCode != null &&
                  task.gigacodeContinueExitCode !== 0 && (
                    <div className="text-[11px] text-red-700">
                      Ошибка (exit {task.gigacodeContinueExitCode}) — см. лог
                    </div>
                  )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-slate-500">PID</dt>
                  <dd className="font-mono text-[10px]">
                    {task.gigacodeContinuePid}
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
              </div>
            </details>
          )}

          {task.proposalUpdatePid && (
            <details
              className="group mt-3 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center gap-2 font-semibold text-slate-800">
                <ProcessStatusIcon
                  alive={proposalUpdateAlive}
                  exitCode={task.proposalUpdateExitCode}
                />
                <span>Обновление proposal.md</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {task.proposalUpdateStartedAt && (
                  <div className="text-[11px] text-slate-500">
                    Запущено: {formatDateTime(task.proposalUpdateStartedAt)}
                  </div>
                )}
                {!proposalUpdateAlive &&
                  task.proposalUpdateExitCode != null &&
                  task.proposalUpdateExitCode !== 0 && (
                    <div className="text-[11px] text-red-700">
                      Ошибка (exit {task.proposalUpdateExitCode}) — см. лог
                    </div>
                  )}
                {task.proposalUpdateComments && (
                  <div className="text-[11px] text-slate-600">
                    <span className="text-slate-500">Комментарий:</span>{" "}
                    <span className="whitespace-pre-wrap">
                      {task.proposalUpdateComments}
                    </span>
                  </div>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-slate-500">PID</dt>
                  <dd className="font-mono text-[10px]">
                    {task.proposalUpdatePid}
                  </dd>
                  {task.proposalUpdateLogPath && (
                    <>
                      <dt className="text-slate-500">Лог</dt>
                      <dd className="font-mono text-[10px] break-all text-slate-500">
                        {task.proposalUpdateLogPath}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </details>
          )}

          {task.deltaSpecCreatePid && (
            <details
              className="group mt-3 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center gap-2 font-semibold text-slate-800">
                <ProcessStatusIcon
                  alive={deltaSpecCreateAlive}
                  exitCode={task.deltaSpecCreateExitCode}
                />
                <span>Создание дельта-спецификаций</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {task.deltaSpecCreateStartedAt && (
                  <div className="text-[11px] text-slate-500">
                    Запущено: {formatDateTime(task.deltaSpecCreateStartedAt)}
                  </div>
                )}
                {!deltaSpecCreateAlive &&
                  task.deltaSpecCreateExitCode != null &&
                  task.deltaSpecCreateExitCode !== 0 && (
                    <div className="text-[11px] text-red-700">
                      Ошибка (exit {task.deltaSpecCreateExitCode}) — см. лог
                    </div>
                  )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-slate-500">PID</dt>
                  <dd className="font-mono text-[10px]">
                    {task.deltaSpecCreatePid}
                  </dd>
                  {task.deltaSpecCreateLogPath && (
                    <>
                      <dt className="text-slate-500">Лог</dt>
                      <dd className="font-mono text-[10px] break-all text-slate-500">
                        {task.deltaSpecCreateLogPath}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </details>
          )}

          {task.deltaSpecUpdatePid && (
            <details
              className="group mt-3 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center gap-2 font-semibold text-slate-800">
                <ProcessStatusIcon
                  alive={deltaSpecUpdateAlive}
                  exitCode={task.deltaSpecUpdateExitCode}
                />
                <span>Обновление дельта-спецификаций</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {task.deltaSpecUpdateStartedAt && (
                  <div className="text-[11px] text-slate-500">
                    Запущено: {formatDateTime(task.deltaSpecUpdateStartedAt)}
                  </div>
                )}
                {!deltaSpecUpdateAlive &&
                  task.deltaSpecUpdateExitCode != null &&
                  task.deltaSpecUpdateExitCode !== 0 && (
                    <div className="text-[11px] text-red-700">
                      Ошибка (exit {task.deltaSpecUpdateExitCode}) — см. лог
                    </div>
                  )}
                {task.deltaSpecUpdateComments && (
                  <div className="text-[11px] text-slate-600">
                    <span className="text-slate-500">Комментарий:</span>{" "}
                    <span className="whitespace-pre-wrap">
                      {task.deltaSpecUpdateComments}
                    </span>
                  </div>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-slate-500">PID</dt>
                  <dd className="font-mono text-[10px]">
                    {task.deltaSpecUpdatePid}
                  </dd>
                  {task.deltaSpecUpdateLogPath && (
                    <>
                      <dt className="text-slate-500">Лог</dt>
                      <dd className="font-mono text-[10px] break-all text-slate-500">
                        {task.deltaSpecUpdateLogPath}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </details>
          )}

          {task.designCreatePid && (
            <details
              className="group mt-3 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center gap-2 font-semibold text-slate-800">
                <ProcessStatusIcon
                  alive={designCreateAlive}
                  exitCode={task.designCreateExitCode}
                />
                <span>Создание дизайна</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {task.designCreateStartedAt && (
                  <div className="text-[11px] text-slate-500">
                    Запущено: {formatDateTime(task.designCreateStartedAt)}
                  </div>
                )}
                {!designCreateAlive &&
                  task.designCreateExitCode != null &&
                  task.designCreateExitCode !== 0 && (
                    <div className="text-[11px] text-red-700">
                      Ошибка (exit {task.designCreateExitCode}) — см. лог
                    </div>
                  )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-slate-500">PID</dt>
                  <dd className="font-mono text-[10px]">
                    {task.designCreatePid}
                  </dd>
                  {task.designCreateLogPath && (
                    <>
                      <dt className="text-slate-500">Лог</dt>
                      <dd className="font-mono text-[10px] break-all text-slate-500">
                        {task.designCreateLogPath}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </details>
          )}

          {task.designUpdatePid && (
            <details
              className="group mt-3 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center gap-2 font-semibold text-slate-800">
                <ProcessStatusIcon
                  alive={designUpdateAlive}
                  exitCode={task.designUpdateExitCode}
                />
                <span>Обновление дизайна</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {task.designUpdateStartedAt && (
                  <div className="text-[11px] text-slate-500">
                    Запущено: {formatDateTime(task.designUpdateStartedAt)}
                  </div>
                )}
                {!designUpdateAlive &&
                  task.designUpdateExitCode != null &&
                  task.designUpdateExitCode !== 0 && (
                    <div className="text-[11px] text-red-700">
                      Ошибка (exit {task.designUpdateExitCode}) — см. лог
                    </div>
                  )}
                {task.designUpdateComments && (
                  <div className="text-[11px] text-slate-600">
                    <span className="text-slate-500">Комментарий:</span>{" "}
                    <span className="whitespace-pre-wrap">
                      {task.designUpdateComments}
                    </span>
                  </div>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-slate-500">PID</dt>
                  <dd className="font-mono text-[10px]">
                    {task.designUpdatePid}
                  </dd>
                  {task.designUpdateLogPath && (
                    <>
                      <dt className="text-slate-500">Лог</dt>
                      <dd className="font-mono text-[10px] break-all text-slate-500">
                        {task.designUpdateLogPath}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </details>
          )}

          {task.adrCreatePid && (
            <details
              className="group mt-3 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center gap-2 font-semibold text-slate-800">
                <ProcessStatusIcon
                  alive={adrCreateAlive}
                  exitCode={task.adrCreateExitCode}
                />
                <span>Создание ADR</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {task.adrCreateStartedAt && (
                  <div className="text-[11px] text-slate-500">
                    Запущено: {formatDateTime(task.adrCreateStartedAt)}
                  </div>
                )}
                {!adrCreateAlive &&
                  task.adrCreateExitCode != null &&
                  task.adrCreateExitCode !== 0 && (
                    <div className="text-[11px] text-red-700">
                      Ошибка (exit {task.adrCreateExitCode}) — см. лог
                    </div>
                  )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-slate-500">PID</dt>
                  <dd className="font-mono text-[10px]">
                    {task.adrCreatePid}
                  </dd>
                  {task.adrCreateLogPath && (
                    <>
                      <dt className="text-slate-500">Лог</dt>
                      <dd className="font-mono text-[10px] break-all text-slate-500">
                        {task.adrCreateLogPath}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </details>
          )}

          {task.adrUpdatePid && (
            <details
              className="group mt-3 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center gap-2 font-semibold text-slate-800">
                <ProcessStatusIcon
                  alive={adrUpdateAlive}
                  exitCode={task.adrUpdateExitCode}
                />
                <span>Обновление ADR</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {task.adrUpdateStartedAt && (
                  <div className="text-[11px] text-slate-500">
                    Запущено: {formatDateTime(task.adrUpdateStartedAt)}
                  </div>
                )}
                {!adrUpdateAlive &&
                  task.adrUpdateExitCode != null &&
                  task.adrUpdateExitCode !== 0 && (
                    <div className="text-[11px] text-red-700">
                      Ошибка (exit {task.adrUpdateExitCode}) — см. лог
                    </div>
                  )}
                {task.adrUpdateComments && (
                  <div className="text-[11px] text-slate-600">
                    <span className="text-slate-500">Комментарий:</span>{" "}
                    <span className="whitespace-pre-wrap">
                      {task.adrUpdateComments}
                    </span>
                  </div>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-slate-500">PID</dt>
                  <dd className="font-mono text-[10px]">
                    {task.adrUpdatePid}
                  </dd>
                  {task.adrUpdateLogPath && (
                    <>
                      <dt className="text-slate-500">Лог</dt>
                      <dd className="font-mono text-[10px] break-all text-slate-500">
                        {task.adrUpdateLogPath}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </details>
          )}

          {/* Done-stage deploy cards (analyst mode only). They sit
              next to the other process cards because they're
              sub-steps of the same final pipeline. */}
          {task.stage === "done" && task.mode === "analyst" && task.pushPid && (
            <details
              className="group mt-3 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center gap-2 font-semibold text-slate-800">
                <ProcessStatusIcon
                  alive={
                    task.pushExitCode == null && isProcessAlive(task.pushPid)
                  }
                  exitCode={task.pushExitCode}
                />
                <span>Опубликовать ветку</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {task.pushedAt && (
                  <div className="text-[11px] text-slate-500">
                    Опубликовано: {formatDateTime(task.pushedAt)}
                  </div>
                )}
                {task.pushExitCode != null &&
                  task.pushExitCode !== 0 && (
                    <div className="text-[11px] text-red-700">
                      {task.pushError ??
                        `Ошибка (exit ${task.pushExitCode}) — см. лог`}
                    </div>
                  )}
                {task.pushRemoteUrl && (
                  <div className="text-[11px] text-slate-500">
                    Remote:{" "}
                    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                      {task.pushRemoteUrl}
                    </code>
                  </div>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-slate-500">PID</dt>
                  <dd className="font-mono text-[10px]">{task.pushPid}</dd>
                  {task.pushLogPath && (
                    <>
                      <dt className="text-slate-500">Лог</dt>
                      <dd className="font-mono text-[10px] break-all text-slate-500">
                        {task.pushLogPath}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </details>
          )}

          {task.stage === "done" &&
            task.mode === "analyst" &&
            task.pullRequestPid && (
              <details
                className="group mt-3 rounded-md border border-border bg-white px-4 py-3 text-[12px] text-slate-600 [&>summary]:cursor-pointer [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex items-center gap-2 font-semibold text-slate-800">
                  <ProcessStatusIcon
                    alive={
                      task.pullRequestExitCode == null &&
                      isProcessAlive(task.pullRequestPid)
                    }
                    exitCode={task.pullRequestExitCode}
                  />
                  <span>Создание pull request</span>
                  <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90" />
                </summary>
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  {task.pullRequestStartedAt && (
                    <div className="text-[11px] text-slate-500">
                      Запущено:{" "}
                      {formatDateTime(task.pullRequestStartedAt)}
                    </div>
                  )}
                  {task.pullRequestExitCode != null &&
                    task.pullRequestExitCode !== 0 && (
                      <div className="text-[11px] text-red-700">
                        {task.pullRequestError ??
                          `Ошибка (exit ${task.pullRequestExitCode}) — см. лог`}
                      </div>
                    )}
                  {task.pullRequestUrl && (
                    <div className="text-[11px] text-slate-500">
                      PR:{" "}
                      <a
                        className="text-blue-700 underline break-all"
                        href={task.pullRequestUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {task.pullRequestUrl}
                      </a>
                    </div>
                  )}
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                    <dt className="text-slate-500">PID</dt>
                    <dd className="font-mono text-[10px]">
                      {task.pullRequestPid}
                    </dd>
                    {task.pullRequestLogPath && (
                      <>
                        <dt className="text-slate-500">Лог</dt>
                        <dd className="font-mono text-[10px] break-all text-slate-500">
                          {task.pullRequestLogPath}
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
              </details>
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

          <div className="mt-3 flex items-start justify-between gap-2">
            <div className="flex gap-2">
              {folderExists && <OpenInFinderForm tag={tag} />}
              <CopyPathButton path={relPath} />
            </div>
            <div className="flex flex-col items-end gap-2">
              {task.stage === "done" && task.mode === "analyst" ? (
                <DoneTaskActions tag={tag} />
              ) : (
                <TaskActions
                  tag={tag}
                  title={task.summary.title}
                  description={task.description}
                  jiraUrl={task.jiraUrl ?? undefined}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProcessStatusIcon({
  alive,
  exitCode,
}: {
  alive: boolean;
  exitCode?: number | null;
}) {
  if (alive) {
    return <Loader2 className="h-4 w-4 animate-spin text-slate-500" />;
  }
  const failed = exitCode != null && exitCode !== 0;
  if (failed) {
    return <CircleAlert className="h-4 w-4 text-red-600" />;
  }
  return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
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

