import { execFile } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { findTaskByTagStrict, updateTask } from "@/lib/state";
import {
  runCreateArtifact,
  runUpdateArtifact,
  spawnCreatePullRequestGigacode,
  spawnApplySddLabelGigacode,
  STAGE_CONFIG,
} from "@/lib/continuation";
import { spawnGitPush } from "@/lib/git-push";
import { isProcessAlive } from "@/lib/process";
import { spawnDetachedWithLog } from "@/lib/process-logger";

/**
 * Restart a failed analyst-mode sub-task (openspec-new / create /
 * update / push / pull-request) for the change-proposal on the
 * current stage. Mirrors the developer-mode `/implement/restart`
 * endpoint in shape (single POST, body enum, pre-flight then
 * spawn) but is analyst-mode only and understands the cascade
 * lifecycle:
 *
 *  - restart never touches cascade* fields directly. The same
 *    `cascadeMarkerClearPatch` exit-handler that runs on the
 *    watcher's spawn decides whether the stale marker is
 *    cleared, based on success/failure of THIS run.
 *  - restart of CREATE while a cascade is active is refused
 *    with 409 — the cascade is the canonical re-writer for
 *    artefacts in its scope, and a fresh CREATE would clobber
 *    the cascade-update's output. UPDATE is always allowed
 *    (restart UPDATE with the stored comments is functionally
 *    identical to what cascade-update would have fired next).
 *  - restart of push / pull-request is independent of cascade
 *    (these run after the cascade has fully completed and the
 *    branch has been confirmed into the trunk).
 *
 * Body: `{ stage, sub }`. `stage` identifies which per-stage
 * state fields to read (process cards on the detail page stay
 * visible across stage transitions as a historical record, so
 * a user on `done` can still restart a `delta-spec` create that
 * failed long ago). `sub` must be valid for the given `stage`:
 * `openspec-new` is only for `proposal`; `create` and `update`
 * are only for `proposal`/`delta-spec`/`design`/`adr`; `push`
 * and `pull-request` are only for `done`.
 *
 * Pre-flight (per sub):
 *   - openspec-new: task is on `proposal`, no live `openspecNewPid`,
 *     `openspecNewExitCode` is non-zero (or null with an error).
 *     Re-spawns `openspec new change <tag> --description ...` —
 *     this is idempotent at the openspec-CLI level (errors if
 *     the change folder already exists, which is the user's
 *     signal that they should refresh, not retry).
 *   - create: task is on `stage`, no live `*CreatePid`, the
 *     previous create actually failed (`*CreateExitCode` set
 *     and != 0). No active cascade (409 otherwise). Re-spawns
 *     `runCreateArtifact`.
 *   - update: task is on `stage`, no live `*UpdatePid`, the
 *     previous update actually failed, a stored
 *     `*UpdateComments` exists. Re-spawns `runUpdateArtifact`
 *     with the same comment.
 *   - push: task is on `done`, no live `pushPid`, the previous
 *     push actually failed (`pushExitCode != 0`), the branch
 *     has NOT been pushed successfully yet (`pushedAt` is
 *     unset). Re-spawns `spawnGitPush`. If `pushedAt` is set
 *     we still 409 — restart of a successful push is a no-op
 *     and the user should use `update-branch` instead.
 *   - pull-request: task is on `done`, no live `pullRequestPid`,
 *     the previous PR attempt failed (`pullRequestExitCode`
 *     non-zero, no `pullRequestUrl`), and the branch has been
 *     pushed (`pushedAt` set). Re-spawns
 *     `spawnCreatePullRequestGigacode` with no comments.
 *
 * On success: 202 Accepted with `{ pid, logFile }`, mirroring
 * `/implement/restart`. The detail page re-fetches via
 * `router.refresh()` and the relevant process card flips back
 * to the live-spinner state.
 */

const ALLOWED_STAGES = [
  "proposal",
  "delta-spec",
  "design",
  "adr",
  "done",
] as const;
type AnalystStage = (typeof ALLOWED_STAGES)[number];

const ALLOWED_SUBS = [
  "openspec-new",
  "create",
  "update",
  "push",
  "pull-request",
  "sdd-label",
] as const;
type AnalystSub = (typeof ALLOWED_SUBS)[number];

function isStage(v: unknown): v is AnalystStage {
  return (
    typeof v === "string" && (ALLOWED_STAGES as readonly string[]).includes(v)
  );
}
function isSub(v: unknown): v is AnalystSub {
  return (
    typeof v === "string" && (ALLOWED_SUBS as readonly string[]).includes(v)
  );
}

function isSubValidForStage(sub: AnalystSub, stage: AnalystStage): boolean {
  switch (sub) {
    case "openspec-new":
      return stage === "proposal";
    case "create":
    case "update":
      return (
        stage === "proposal" ||
        stage === "delta-spec" ||
        stage === "design" ||
        stage === "adr"
      );
    case "push":
    case "pull-request":
    case "sdd-label":
      return stage === "done";
  }
}

const SCHEMA = "spec-driven-with-adr";

export async function POST(
  req: NextRequest,
  { params }: { params: { tag: string } },
) {
  const task = await findTaskByTagStrict("analyst", params.tag);
  if (!task) {
    return NextResponse.json(
      { error: `Задача "${params.tag}" не найдена в режиме "analyst"` },
      { status: 404 },
    );
  }
  if (!task.openspecWorktreePath) {
    return NextResponse.json(
      { error: "У задачи не записан openspecWorktreePath" },
      { status: 400 },
    );
  }
  // Remote tasks are read-only mirrors — restart starts a cascade
  // the mirror must never run.
  if (task.remote === true) {
    return NextResponse.json(
      { error: "Задача опубликована другим пользователем — переоткрытие недоступно" },
      { status: 403 },
    );
  }

  let body: { stage?: unknown; sub?: unknown } = {};
  try {
    body = (await req.json()) as { stage?: unknown; sub?: unknown };
  } catch {
    body = {};
  }
  if (!isStage(body.stage)) {
    return NextResponse.json(
      { error: `stage должен быть одним из: ${ALLOWED_STAGES.join(", ")}` },
      { status: 400 },
    );
  }
  if (!isSub(body.sub)) {
    return NextResponse.json(
      { error: `sub должен быть одним из: ${ALLOWED_SUBS.join(", ")}` },
      { status: 400 },
    );
  }

  // Validate sub × stage combination. openspec-new is proposal-
  // only; create/update are proposal/delta-spec/design/adr;
  // push/pull-request are done-only.
  if (!isSubValidForStage(body.sub, body.stage)) {
    return NextResponse.json(
      {
        error: `sub "${body.sub}" недопустим для стадии "${body.stage}"`,
      },
      { status: 400 },
    );
  }

  switch (body.sub) {
    case "openspec-new":
      return handleOpenspecNewRestart(task);
    case "create":
      return handleCreateRestart(task, params.tag);
    case "update":
      return handleUpdateRestart(task, params.tag);
    case "push":
      return handlePushRestart(task, params.tag);
    case "pull-request":
      return handlePullRequestRestart(task, params.tag);
    case "sdd-label":
      return handleSddLabelRestart(task, params.tag);
  }
}

// ── openspec-new ─────────────────────────────────────────────

async function handleOpenspecNewRestart(task: import("@/lib/state").TaskEntry) {
  if (task.openspecNewPid && isProcessAlive(task.openspecNewPid)) {
    return NextResponse.json(
      { error: "Создание директории ещё выполняется — дождитесь завершения" },
      { status: 409 },
    );
  }
  if (
    task.openspecNewExitCode != null &&
    task.openspecNewExitCode === 0
  ) {
    return NextResponse.json(
      {
        error:
          "Создание директории завершилось успешно — перезапуск не требуется",
      },
      { status: 409 },
    );
  }
  if (!task.description) {
    return NextResponse.json(
      {
        error: "У задачи не сохранён description — перезапуск невозможен",
      },
      { status: 400 },
    );
  }

  const logFile = `.sdd-board/logs/repos/${task.summary.changeName}.openspec-new.log`;
  try {
    const result = spawnDetachedWithLog({
      command: "openspec",
      argv: [
        "new",
        "change",
        task.summary.changeName,
        "--description",
        task.description,
        "--schema",
        SCHEMA,
      ],
      logFile,
      header: `openspec new change (restart) for ${task.summary.changeName}`,
      cwd: task.openspecWorktreePath,
    });
    const pid = result.pid || null;
    if (pid == null) {
      return NextResponse.json(
        { error: "Не удалось запустить openspec new change" },
        { status: 500 },
      );
    }
    const exitHandler = (exitCode: number | null, signal: string | null) =>
      updateTask("analyst", task.summary.changeName, {
        openspecNewExitCode: exitCode,
        openspecNewExitSignal: signal,
      });
    result.promise
      .then(({ exitCode, signal }) => exitHandler(exitCode, signal))
      .catch((e) =>
        console.error(`openspec-new restart exit handler error:`, e),
      );
    await updateTask("analyst", task.summary.changeName, {
      openspecNewPid: pid,
      openspecNewStartedAt: new Date().toISOString(),
      openspecNewLogPath: logFile,
      openspecNewExitCode: null,
      openspecNewExitSignal: null,
      // Clear the previous "spawn never started" marker so a fresh,
      // live run isn't shadowed by stale red-alert UI from before
      // the user pressed Restart. The next failure re-sets it via
      // the create-route catch block.
      openspecNewSpawnError: null,
    });
    return NextResponse.json(
      { ok: true, pid, logFile },
      { status: 202 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: `openspec new change: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}

// ── create ───────────────────────────────────────────────────

async function handleCreateRestart(
  task: import("@/lib/state").TaskEntry,
  tag: string,
) {
  // The route pre-flight already verified body.sub × body.stage.
  // `task.stage` is typed as the broader `Stage` (includes
  // "plan") but the pre-flight prevents us getting here with a
  // developer-mode stage; the cast is therefore safe.
  const stage = task.stage as AnalystStage;
  const createPid = getCreatePidForStage(task, stage);
  if (createPid && isProcessAlive(createPid)) {
    return NextResponse.json(
      {
        error:
          "Создание артефакта ещё выполняется — дождитесь завершения",
      },
      { status: 409 },
    );
  }
  // Refuse restart of CREATE while a cascade is active — the
  // cascade is the canonical re-writer for artefacts in its
  // scope, and a fresh CREATE would clobber the cascade-update's
  // output. The user can wait for the cascade to finish, or
  // pencil-update to cancel the cascade (which is intentional:
  // pencil = "do something different").
  if (task.cascadeComment) {
    return NextResponse.json(
      {
        error:
          "Идёт каскадное обновление — перезапуск создания недоступен, дождитесь окончания каскада",
      },
      { status: 409 },
    );
  }
  const createExit = getCreateExitForStage(task, stage);
  if (createExit == null || createExit === 0) {
    return NextResponse.json(
      {
        error:
          "Создание не завершилось с ошибкой — перезапуск не требуется",
      },
      { status: 409 },
    );
  }

  const config = STAGE_CONFIG[stage];
  if (!config) {
    return NextResponse.json(
      { error: `Неизвестная стадия: ${stage}` },
      { status: 400 },
    );
  }
  const result = await runCreateArtifact(task, tag, config);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(
    {
      ok: true,
      pid: result.pid,
      logFile: result.logFile,
    },
    { status: 202 },
  );
}

// ── update ───────────────────────────────────────────────────

async function handleUpdateRestart(
  task: import("@/lib/state").TaskEntry,
  tag: string,
) {
  // See handleCreateRestart — the cast is safe given the route's
  // sub × stage pre-flight.
  const stage = task.stage as AnalystStage;
  const updatePid = getUpdatePidForStage(task, stage);
  if (updatePid && isProcessAlive(updatePid)) {
    return NextResponse.json(
      { error: "Обновление ещё выполняется — дождитесь завершения" },
      { status: 409 },
    );
  }
  const updateExit = getUpdateExitForStage(task, stage);
  if (updateExit == null || updateExit === 0) {
    return NextResponse.json(
      {
        error:
          "Обновление не завершилось с ошибкой — перезапуск не требуется",
      },
      { status: 409 },
    );
  }
  const comments = getUpdateCommentsForStage(task, stage);
  if (!comments) {
    return NextResponse.json(
      {
        error:
          "У предыдущего обновления не сохранён комментарий — нечего перезапускать",
      },
      { status: 400 },
    );
  }

  const config = STAGE_CONFIG[stage];
  if (!config) {
    return NextResponse.json(
      { error: `Неизвестная стадия: ${stage}` },
      { status: 400 },
    );
  }
  // Deliberately do NOT touch task.cascade* fields. Restart
  // re-spawns with the same comments the cascade (or pencil)
  // stored; cleanup of the stale marker is handled by
  // cascadeMarkerClearPatch in the exit handler on success.
  const result = await runUpdateArtifact(task, tag, config, comments);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(
    {
      ok: true,
      pid: result.pid,
      logFile: result.logFile,
    },
    { status: 202 },
  );
}

// ── push (done-stage «Опубликовать ветку») ──────────────────

async function handlePushRestart(
  task: import("@/lib/state").TaskEntry,
  tag: string,
) {
  if (task.pushPid && isProcessAlive(task.pushPid)) {
    return NextResponse.json(
      { error: "Публикация ветки ещё выполняется — дождитесь завершения" },
      { status: 409 },
    );
  }
  if (task.pushedAt) {
    return NextResponse.json(
      {
        error:
          "Ветка уже опубликована — для повторной отправки используйте «Обновить ветку»",
      },
      { status: 409 },
    );
  }
  if (task.pushExitCode == null || task.pushExitCode === 0) {
    return NextResponse.json(
      {
        error:
          "Публикация ветки не завершилась с ошибкой — перезапуск не требуется",
      },
      { status: 409 },
    );
  }

  const branch = await runGit(task.openspecWorktreePath!, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ])
    .then((r) => r.stdout.trim())
    .catch(() => "");
  if (!branch) {
    return NextResponse.json(
      {
        error:
          "Не удалось определить текущую ветку — проверьте, что worktree на feature-ветке",
      },
      { status: 500 },
    );
  }

  const spawned = spawnGitPush(task.openspecWorktreePath!, branch, tag);
  if (spawned.pid == null) {
    return NextResponse.json(
      { error: spawned.error ?? "Не удалось запустить git push" },
      { status: 500 },
    );
  }
  await updateTask("analyst", tag, {
    pushPid: spawned.pid,
    pushStartedAt: new Date().toISOString(),
    pushLogPath: spawned.logFile,
    pushExitCode: null,
    pushExitSignal: null,
    pushError: undefined,
  });
  return NextResponse.json(
    {
      ok: true,
      pid: spawned.pid,
      logFile: spawned.logFile,
    },
    { status: 202 },
  );
}

// ── pull-request (done-stage «Сделать pull request») ────────

async function handlePullRequestRestart(
  task: import("@/lib/state").TaskEntry,
  tag: string,
) {
  if (task.pullRequestPid && isProcessAlive(task.pullRequestPid)) {
    return NextResponse.json(
      {
        error:
          "Создание pull request ещё выполняется — дождитесь завершения",
      },
      { status: 409 },
    );
  }
  if (task.pullRequestUrl) {
    return NextResponse.json(
      {
        error:
          "Pull request уже создан — для повторного запуска сначала очистите ссылку",
      },
      { status: 409 },
    );
  }
  if (
    task.pullRequestExitCode == null ||
    task.pullRequestExitCode === 0
  ) {
    return NextResponse.json(
      {
        error:
          "Создание pull request не завершилось с ошибкой — перезапуск не требуется",
      },
      { status: 409 },
    );
  }
  if (!task.pushedAt) {
    return NextResponse.json(
      {
        error:
          "Сначала опубликуйте ветку — pull request невозможен без push",
      },
      { status: 409 },
    );
  }
  const result = await spawnCreatePullRequestGigacode(task, tag, "");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(
    {
      ok: true,
      pid: result.pid,
      logFile: result.logFile,
    },
    { status: 202 },
  );
}

// ── sdd-label (done-stage «Поставить sdd-метку») ────────────

async function handleSddLabelRestart(
  task: import("@/lib/state").TaskEntry,
  tag: string,
) {
  if (task.sddLabelPid && isProcessAlive(task.sddLabelPid)) {
    return NextResponse.json(
      {
        error: "Постановка sdd-метки уже выполняется — дождитесь завершения",
      },
      { status: 409 },
    );
  }
  if (task.sddLabelAppliedAt && task.sddLabelExitCode === 0) {
    return NextResponse.json(
      {
        error:
          "sdd-метка уже поставлена — для повтора сначала очистите отметку времени",
      },
      { status: 409 },
    );
  }
  if (task.sddLabelExitCode == null || task.sddLabelExitCode === 0) {
    return NextResponse.json(
      {
        error:
          "Постановка sdd-метки не завершилась с ошибкой — перезапуск не требуется",
      },
      { status: 409 },
    );
  }
  const result = await spawnApplySddLabelGigacode(task, tag, "");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(
    {
      ok: true,
      pid: result.pid,
      logFile: result.logFile,
    },
    { status: 202 },
  );
}

// ── per-stage field getters (mirror lib/continuation.ts) ─────

function getCreatePidForStage(
  task: import("@/lib/state").TaskEntry,
  stage: AnalystStage,
): number | null {
  switch (stage) {
    case "proposal":
      return task.gigacodeContinuePid ?? null;
    case "delta-spec":
      return task.deltaSpecCreatePid ?? null;
    case "design":
      return task.designCreatePid ?? null;
    case "adr":
      return task.adrCreatePid ?? null;
    default:
      return null;
  }
}

function getCreateExitForStage(
  task: import("@/lib/state").TaskEntry,
  stage: AnalystStage,
): number | null | undefined {
  switch (stage) {
    case "proposal":
      return task.gigacodeContinueExitCode;
    case "delta-spec":
      return task.deltaSpecCreateExitCode;
    case "design":
      return task.designCreateExitCode;
    case "adr":
      return task.adrCreateExitCode;
    default:
      return undefined;
  }
}

function getUpdatePidForStage(
  task: import("@/lib/state").TaskEntry,
  stage: AnalystStage,
): number | null {
  switch (stage) {
    case "proposal":
      return task.proposalUpdatePid ?? null;
    case "delta-spec":
      return task.deltaSpecUpdatePid ?? null;
    case "design":
      return task.designUpdatePid ?? null;
    case "adr":
      return task.adrUpdatePid ?? null;
    default:
      return null;
  }
}

function getUpdateExitForStage(
  task: import("@/lib/state").TaskEntry,
  stage: AnalystStage,
): number | null | undefined {
  switch (stage) {
    case "proposal":
      return task.proposalUpdateExitCode;
    case "delta-spec":
      return task.deltaSpecUpdateExitCode;
    case "design":
      return task.designUpdateExitCode;
    case "adr":
      return task.adrUpdateExitCode;
    default:
      return undefined;
  }
}

function getUpdateCommentsForStage(
  task: import("@/lib/state").TaskEntry,
  stage: AnalystStage,
): string | undefined {
  switch (stage) {
    case "proposal":
      return task.proposalUpdateComments;
    case "delta-spec":
      return task.deltaSpecUpdateComments;
    case "design":
      return task.designUpdateComments;
    case "adr":
      return task.adrUpdateComments;
    default:
      return undefined;
  }
}

// Tiny shell wrapper for the push-restart path. Kept local —
// the main push route in /api/changes/[tag]/push/route.ts has
// its own copy because it needs to run on a slightly different
// surface; sharing would mean hoisting it to lib/ or
// duplicating it. We duplicate to keep this route self-contained.
function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { maxBuffer: 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `git ${args.join(" ")} failed: ${err.message}\n${stderr}`,
            ),
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}