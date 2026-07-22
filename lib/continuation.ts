import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { readState, updateTask } from "./state";
import {
  ensureLogDir,
  processLogPath,
  spawnGigacodeWithLog,
} from "./process-logger";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts?.cwd, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `${cmd} ${args.join(" ")} failed: ${err.message}\n${stderr}`,
            ),
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

// Workflow schema passed explicitly to the openspec instructions call.
// Must match the schema used by `openspec new change` in
// app/api/changes/route.ts.
const SCHEMA = "spec-driven-with-adr";

// Generic prompt templates, used by every artifact-creation /
// artifact-update stage (proposal, specs, design, adr, …). Each
// stage substitutes a different openspec instructions JSON into
// the template and runs gigacode --prompt on the result. The
// {json} placeholder is the openspec instructions output; {artifact}
// is the current file content for update calls; {comments} is the
// analyst's free-form request.
const CREATE_ARTIFACT_PROMPT_TEMPLATE_PATH = path.join(
  process.cwd(),
  "templates",
  "spec-driven",
  "create-artifact-prompt-template.md",
);
const UPDATE_ARTIFACT_PROMPT_TEMPLATE_PATH = path.join(
  process.cwd(),
  "templates",
  "spec-driven",
  "update-artifact-prompt-template.md",
);

// In-memory cache for template content. Keyed by absolute path +
// file's mtime so edits are picked up on the next invocation without
// a server restart. The template file is read at most once per
// mtime change per path.
const templateCache = new Map<
  string,
  { mtimeMs: number; content: string }
>();

async function loadTemplate(absolutePath: string): Promise<string> {
  const stat = await fs.stat(absolutePath);
  const cached = templateCache.get(absolutePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.content;
  }
  const content = await fs.readFile(absolutePath, "utf-8");
  templateCache.set(absolutePath, { mtimeMs: stat.mtimeMs, content });
  return content;
}

const loadCreateArtifactPromptTemplate = () =>
  loadTemplate(CREATE_ARTIFACT_PROMPT_TEMPLATE_PATH);
const loadUpdateArtifactPromptTemplate = () =>
  loadTemplate(UPDATE_ARTIFACT_PROMPT_TEMPLATE_PATH);

// ============================================================================
// Generic artifact pipeline
// ============================================================================

export type ArtifactStep = "create" | "update";

/**
 * Describes which openspec instructions subcommand to run for the
 * artifact we're generating, and which path inside the change
 * folder the finished artifact is expected at (used to gate
 * readiness checks and to detect when an artifact is missing).
 *
 * For each analyst stage the pair is fixed:
 *   proposal → { instructionsArtifact: "proposal", artifactSubpath: "proposal.md" }
 *   specs     → { instructionsArtifact: "specs",     artifactSubpath: "specs" /* dir *\/ }
 *   design    → { instructionsArtifact: "design",    artifactSubpath: "design.md" }
 *   adr       → { instructionsArtifact: "adr",      artifactSubpath: "docs/adr" }
 */
export interface ArtifactConfig {
  stage: string;
  instructionsArtifact: "proposal" | "specs" | "design" | "adr";
  /**
   * Path relative to `<worktree>/openspec/changes/<tag>/`. Use a
   * trailing slash convention (or a directory marker) so the
   * existence check knows whether it's looking for a file or a
   * directory. For "specs" we expect a directory.
   */
  artifactSubpath: string;
}

const STAGE_CONFIG: Record<string, ArtifactConfig> = {
  proposal: {
    stage: "proposal",
    instructionsArtifact: "proposal",
    artifactSubpath: "proposal.md",
  },
  "delta-spec": {
    stage: "delta-spec",
    instructionsArtifact: "specs",
    artifactSubpath: "specs",
  },
  design: {
    stage: "design",
    instructionsArtifact: "design",
    artifactSubpath: "design.md",
  },
};

/**
 * Return true if the artifact for the given stage exists in the
 * change folder. For "specs" we look for a non-empty directory;
 * for proposal/design/adr we look for a file.
 */
export async function isStageReady(
  worktree: string,
  changeName: string,
  config: ArtifactConfig,
): Promise<boolean> {
  const target = path.join(
    worktree,
    "openspec",
    "changes",
    changeName,
    config.artifactSubpath,
  );
  if (config.artifactSubpath.endsWith("/")) {
    try {
      const entries = await fs.readdir(target);
      return entries.length > 0;
    } catch {
      return false;
    }
  }
  return exists(target);
}

// ============================================================================
// Auto-trigger loop
// ============================================================================

/**
 * Drive every auto-triggerable analyst-mode stage for every task.
 *
 * Each stage is a small pipeline observed via disk side-effects
 * (per `feedback/auto-trigger-from-observed-lifecycle.md`):
 *
 *   stage = "proposal"
 *     step 1 (handled by POST /api/changes):
 *       `openspec new change <tag> --description <desc>` in worktree.
 *     step 2 (this function, when .openspec.yaml present but
 *       proposal.md not yet):
 *       `openspec instructions proposal --change <tag> --json` then
 *       `gigacode --prompt <template-with-json>`.
 *     step 3:
 *       git commit on the feature branch. Gated on user pressing
 *       "Подтверждаю" — invoked from POST /api/changes/[tag]/confirm,
 *       NOT from here.
 *
 *   stage = "delta-spec"
 *     step 2 only (proposal is already done + committed):
 *       `openspec instructions specs --change <tag> --json` then
 *       `gigacode --prompt <template-with-json>`.
 *     step 3:
 *       git commit, gated on "Подтверждаю" on the delta-spec card.
 *
 * Each step is idempotent via per-stage PIDs / commit flags in
 * state. Safe to call on every render and from the watcher.
 */
export async function triggerContinueIfNeeded(
  _openspecDir: string,
): Promise<string[]> {
  const state = await readState();
  const triggered: string[] = [];
  await ensureLogDir();

  for (const [changeName, task] of Object.entries(state.tasks)) {
    if (!task.openspecWorktreePath) continue;
    const config = STAGE_CONFIG[task.stage];
    if (!config) continue;
    const changePath = path.join(
      task.openspecWorktreePath,
      "openspec",
      "changes",
      changeName,
    );
    if (!(await exists(changePath))) continue;

    const ready = await isStageReady(
      task.openspecWorktreePath,
      changeName,
      config,
    );
    if (ready) {
      // Artifact is on disk; the analyst (human) will press
      // "Подтверждаю" on the detail page, and that POST commits the
      // worktree and advances stage. Auto-triggering the commit here
      // would skip the explicit confirmation step the user wants as
      // a gate.
      continue;
    }

    // Spawn the gigacode pipeline for this stage (idempotent: only
    // when no live or completed-but-failed PID is set).
    if (getCreatePid(task)) continue;
    const spawned = await spawnCreateArtifactGigacode(
      task,
      changeName,
      changePath,
      config,
    );
    if (spawned) triggered.push(changeName);
  }
  return triggered;
}

/**
 * Stage-specific getter for the gigacode-create PID. Different
 * stages store it under different state fields (legacy
 * `gigacodeContinuePid` for proposal, dedicated
 * `deltaSpecCreatePid` for delta-spec, …). New stages should add
 * their field here.
 */
function getCreatePid(task: import("./state").TaskEntry): number | null {
  switch (task.stage) {
    case "proposal":
      return task.gigacodeContinuePid ?? null;
    case "delta-spec":
      return task.deltaSpecCreatePid ?? null;
    case "design":
      return task.designCreatePid ?? null;
    default:
      return null;
  }
}

async function spawnCreateArtifactGigacode(
  task: import("./state").TaskEntry,
  changeName: string,
  _changePath: string,
  config: ArtifactConfig,
): Promise<boolean> {
  const worktree = task.openspecWorktreePath!;

  // Get the artifact-generation instructions as JSON.
  let instructionsJson: string;
  try {
    const { stdout } = await run(
      "openspec",
      [
        "instructions",
        config.instructionsArtifact,
        "--change",
        changeName,
        "--json",
        "--schema",
        SCHEMA,
      ],
      { cwd: worktree },
    );
    instructionsJson = stdout;
  } catch (e) {
    console.error(
      `openspec instructions ${config.instructionsArtifact} failed for ${changeName}:`,
      e,
    );
    // Mark as error so the UI surfaces it; don't retry forever (the
    // earlier step exit code stays unchanged — this is a separate
    // failure mode we want to make visible).
    const errField =
      config.stage === "proposal" ? "commitError" : "deltaSpecCommitError";
    await updateTask(changeName, {
      [errField]: `openspec instructions: ${(e as Error).message}`,
    } as Partial<import("./state").TaskEntry>);
    return false;
  }

  const template = await loadCreateArtifactPromptTemplate();
  const prompt = template.replace("{json}", instructionsJson);

  const logFile = processLogPath(changeName, "continue", config.stage);
  await fs.writeFile(
    logFile,
    [
      `# gigacode --prompt (${config.stage} create) for ${changeName}`,
      `# add-dir: ${worktree}`,
      `# approval-mode: auto-edit`,
      `# argv: gigacode --prompt <prompt> --approval-mode=auto-edit --add-dir ${worktree}`,
      `# prompt-length: ${prompt.length} chars`,
      `# openspec instructions output-length: ${instructionsJson.length} chars`,
      "",
      "# ----- prompt ----->",
      prompt,
      "# <----- prompt -----",
      "",
    ].join("\n"),
    { flag: "w" },
  );

  let pid: number | null = null;
  try {
    const result = spawnGigacodeWithLog({
      argv: ["--prompt", prompt],
      logFile,
      header: undefined,
      addDir: worktree,
      approvalMode: "auto-edit",
    });
    pid = result.pid || null;
    const exitHandler = (code: number | null, signal: string | null) =>
      updateTask(
        changeName,
        buildCreateExitPatch(config.stage, code, signal),
      );
    result.promise
      .then(({ exitCode, signal }) => exitHandler(exitCode, signal))
      .catch((e) =>
        console.error(`gigacode-continue (${config.stage}) exit handler error:`, e),
      );
  } catch (e) {
    console.error(
      `gigacode --prompt spawn threw for ${changeName}:`,
      e,
    );
  }

  if (pid != null) {
    await updateTask(
      changeName,
      buildCreateSpawnPatch(config.stage, pid, logFile),
    );
    return true;
  }
  console.error(
    `Failed to spawn gigacode --prompt for ${changeName} (${config.stage})`,
  );
  return false;
}

function buildCreateExitPatch(
  stage: string,
  exitCode: number | null,
  signal: string | null,
): Partial<import("./state").TaskEntry> {
  switch (stage) {
    case "proposal":
      return {
        gigacodeContinueExitCode: exitCode,
        gigacodeContinueExitSignal: signal,
      };
    case "delta-spec":
      return {
        deltaSpecCreateExitCode: exitCode,
        deltaSpecCreateExitSignal: signal,
      };
    case "design":
      return {
        designCreateExitCode: exitCode,
        designCreateExitSignal: signal,
      };
    default:
      return {};
  }
}

function buildCreateSpawnPatch(
  stage: string,
  pid: number,
  logFile: string,
): Partial<import("./state").TaskEntry> {
  switch (stage) {
    case "proposal":
      return {
        gigacodeContinuePid: pid,
        gigacodeContinueStartedAt: new Date().toISOString(),
        gigacodeContinueLogPath: logFile,
      };
    case "delta-spec":
      return {
        deltaSpecCreatePid: pid,
        deltaSpecCreateStartedAt: new Date().toISOString(),
        deltaSpecCreateLogPath: logFile,
      };
    case "design":
      return {
        designCreatePid: pid,
        designCreateStartedAt: new Date().toISOString(),
        designCreateLogPath: logFile,
      };
    default:
      return {};
  }
}

// ============================================================================
// Git commit helper
// ============================================================================

/**
 * `git add .` + `git commit` on the feature-branch worktree. Used
 * by the confirm endpoint to record the artifacts written by
 * gigacode on disk. Idempotent via `committedAt` /
 * `deltaSpecCommittedAt` — the confirm endpoint only invokes this
 * once per stage.
 */
export async function commitChange(
  task: import("./state").TaskEntry,
  changeName: string,
  stage: string,
): Promise<boolean> {
  const worktree = task.openspecWorktreePath!;
  const message = buildCommitMessage(task, changeName, stage);
  try {
    await run("git", ["-C", worktree, "add", "."]);
    await run("git", ["-C", worktree, "commit", "-m", message]);
    await updateTask(
      changeName,
      buildCommitPatch(stage, { ok: true }),
    );
    return true;
  } catch (e) {
    const err = e as Error;
    console.error(`git commit failed for ${changeName} (${stage}):`, err);
    // Non-zero exit: surface but DON'T mark as committed — leave the
    // idempotency flag null so a later trigger can retry once the user
    // fixes whatever blocked the commit.
    await updateTask(
      changeName,
      buildCommitPatch(stage, { ok: false, error: err.message }),
    );
    return false;
  }
}

function buildCommitPatch(
  stage: string,
  result: { ok: boolean; error?: string },
): Partial<import("./state").TaskEntry> {
  if (result.ok) {
    const ts = new Date().toISOString();
    switch (stage) {
      case "proposal":
        return {
          committedAt: ts,
          commitExitCode: 0,
          commitError: undefined,
        };
      case "delta-spec":
        return {
          deltaSpecCommittedAt: ts,
          deltaSpecCommitExitCode: 0,
          deltaSpecCommitError: undefined,
        };
      case "design":
        return {
          designCommittedAt: ts,
          designCommitExitCode: 0,
          designCommitError: undefined,
        };
      default:
        return {};
    }
  }
  switch (stage) {
    case "proposal":
      return { commitExitCode: 1, commitError: result.error };
    case "delta-spec":
      return {
        deltaSpecCommitExitCode: 1,
        deltaSpecCommitError: result.error,
      };
    case "design":
      return {
        designCommitExitCode: 1,
        designCommitError: result.error,
      };
    default:
      return {};
  }
}

function buildCommitMessage(
  task: import("./state").TaskEntry,
  changeName: string,
  stage: string,
): string {
  const title = task.summary.title;
  const description = task.description ?? "";
  const jira = task.jiraUrl ?? "";
  const stageLabel =
    stage === "delta-spec"
      ? "delta-spec"
      : stage === "proposal"
        ? "change-proposal"
        : stage === "design"
          ? "design"
          : stage;
  const lines = [
    `[openspec] Add ${stageLabel}: ${title}`,
    "",
    `Tag: ${changeName}`,
  ];
  if (jira) lines.push(`Jira: ${jira}`);
  lines.push("", "Description:", description);
  return lines.join("\n");
}

// ============================================================================
// Artifact update — analyst-initiated re-run with comments
// ============================================================================

export interface UpdateArtifactResult {
  ok: boolean;
  pid?: number | null;
  logFile?: string;
  error?: string;
}

/**
 * Re-run the artifact-generation step with the analyst's free-form
 * request folded in. Reads the existing artifact, fetches fresh
 * openspec instructions, builds the update prompt from
 * templates/spec-driven/update-artifact-prompt-template.md and
 * spawns gigacode --prompt.
 *
 * Each stage stores its update PID / log under stage-specific
 * state fields (proposalUpdate* for proposal, deltaSpecUpdate*
 * for delta-spec). Used by the update-proposal / update-delta-spec
 * endpoints and the ConfirmButton pencil buttons.
 */
export async function runUpdateArtifact(
  task: import("./state").TaskEntry,
  changeName: string,
  config: ArtifactConfig,
  comments: string,
): Promise<UpdateArtifactResult> {
  if (!task.openspecWorktreePath) {
    return { ok: false, error: "Не задан worktree задачи" };
  }
  const worktree = task.openspecWorktreePath;

  // Idempotency: refuse a second spawn while the previous one is
  // still alive. PIDs are stage-specific — see getUpdatePid.
  const livePid = getUpdatePid(task);
  if (livePid && isProcessAliveByPid(livePid)) {
    return {
      ok: false,
      error:
        "Предыдущая итерация обновления ещё выполняется — дождитесь завершения",
    };
  }

  const changePath = path.join(worktree, "openspec", "changes", changeName);
  const artifactAbsPath = path.join(changePath, config.artifactSubpath);

  // Read existing artifact text. For directory-style artifacts
  // (e.g. specs/) we concatenate every .md file under the dir.
  let artifactText: string;
  try {
    artifactText = await readArtifactForPrompt(artifactAbsPath);
  } catch (e) {
    return {
      ok: false,
      error: `Не удалось прочитать артефакт: ${(e as Error).message}`,
    };
  }

  let instructionsJson: string;
  try {
    const { stdout } = await run(
      "openspec",
      [
        "instructions",
        config.instructionsArtifact,
        "--change",
        changeName,
        "--json",
        "--schema",
        SCHEMA,
      ],
      { cwd: worktree },
    );
    instructionsJson = stdout;
  } catch (e) {
    return {
      ok: false,
      error: `openspec instructions ${config.instructionsArtifact}: ${(e as Error).message}`,
    };
  }

  const template = await loadUpdateArtifactPromptTemplate();
  const prompt = template
    .replace("{artifact}", artifactText)
    .replace("{json}", instructionsJson)
    .replace("{comments}", comments);

  const logFile = processLogPath(changeName, "update", config.stage);
  await fs.writeFile(
    logFile,
    [
      `# gigacode --prompt (${config.stage} update) for ${changeName}`,
      `# add-dir: ${worktree}`,
      `# approval-mode: auto-edit`,
      `# argv: gigacode --prompt <prompt> --approval-mode=auto-edit --add-dir ${worktree}`,
      `# artifact-length: ${artifactText.length} chars`,
      `# comments-length: ${comments.length} chars`,
      `# openspec instructions output-length: ${instructionsJson.length} chars`,
      "",
      "# ----- prompt ----->",
      prompt,
      "# <----- prompt -----",
      "",
    ].join("\n"),
    { flag: "w" },
  );

  let pid: number | null = null;
  try {
    const result = spawnGigacodeWithLog({
      argv: ["--prompt", prompt],
      logFile,
      header: undefined,
      addDir: worktree,
      approvalMode: "auto-edit",
    });
    pid = result.pid || null;
    const exitHandler = (code: number | null, signal: string | null) =>
      updateTask(
        changeName,
        buildUpdateExitPatch(config.stage, code, signal),
      );
    result.promise
      .then(({ exitCode, signal }) => exitHandler(exitCode, signal))
      .catch((e) =>
        console.error(`gigacode-update (${config.stage}) exit handler error:`, e),
      );
  } catch (e) {
    return {
      ok: false,
      error: `gigacode spawn: ${(e as Error).message}`,
    };
  }

  if (pid == null) {
    return { ok: false, error: "Не удалось получить PID gigacode" };
  }
  await updateTask(
    changeName,
    buildUpdateSpawnPatch(config.stage, pid, logFile, comments),
  );
  return { ok: true, pid, logFile };
}

/**
 * Read an artifact for the update prompt. For directories
 * (artifactSubpath ending with "/" or being a directory on disk)
 * concatenate every .md file. For files return the file content.
 */
async function readArtifactForPrompt(absolutePath: string): Promise<string> {
  const stat = await fs.stat(absolutePath);
  if (stat.isDirectory()) {
    const entries = await fs.readdir(absolutePath, {
      withFileTypes: true,
    });
    const parts: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;
      const content = await fs.readFile(
        path.join(absolutePath, entry.name),
        "utf-8",
      );
      parts.push(
        `--- ${entry.name} ---\n${content}`,
      );
    }
    return parts.join("\n\n");
  }
  return fs.readFile(absolutePath, "utf-8");
}

function getUpdatePid(task: import("./state").TaskEntry): number | null {
  switch (task.stage) {
    case "proposal":
      return task.proposalUpdatePid ?? null;
    case "delta-spec":
      return task.deltaSpecUpdatePid ?? null;
    case "design":
      return task.designUpdatePid ?? null;
    default:
      return null;
  }
}

function buildUpdateExitPatch(
  stage: string,
  exitCode: number | null,
  signal: string | null,
): Partial<import("./state").TaskEntry> {
  switch (stage) {
    case "proposal":
      return {
        proposalUpdateExitCode: exitCode,
        proposalUpdateExitSignal: signal,
      };
    case "delta-spec":
      return {
        deltaSpecUpdateExitCode: exitCode,
        deltaSpecUpdateExitSignal: signal,
      };
    case "design":
      return {
        designUpdateExitCode: exitCode,
        designUpdateExitSignal: signal,
      };
    default:
      return {};
  }
}

function buildUpdateSpawnPatch(
  stage: string,
  pid: number,
  logFile: string,
  comments: string,
): Partial<import("./state").TaskEntry> {
  const ts = new Date().toISOString();
  switch (stage) {
    case "proposal":
      return {
        proposalUpdatePid: pid,
        proposalUpdateStartedAt: ts,
        proposalUpdateLogPath: logFile,
        proposalUpdateComments: comments,
      };
    case "delta-spec":
      return {
        deltaSpecUpdatePid: pid,
        deltaSpecUpdateStartedAt: ts,
        deltaSpecUpdateLogPath: logFile,
        deltaSpecUpdateComments: comments,
      };
    case "design":
      return {
        designUpdatePid: pid,
        designUpdateStartedAt: ts,
        designUpdateLogPath: logFile,
        designUpdateComments: comments,
      };
    default:
      return {};
  }
}

function isProcessAliveByPid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Backwards-compatible wrappers for the proposal-only stage
// ============================================================================

/**
 * @deprecated Use commitChange(task, changeName, "proposal") instead.
 * Kept for the existing POST /api/changes/[tag]/confirm caller until
 * the confirm handler is migrated to the generic helper.
 */
export async function commitProposalChange(
  task: import("./state").TaskEntry,
  changeName: string,
): Promise<boolean> {
  return commitChange(task, changeName, "proposal");
}

/**
 * @deprecated Use runUpdateArtifact(task, changeName, STAGE_CONFIG.proposal, comments).
 * Kept for POST /api/changes/[tag]/update-proposal.
 */
export async function runProposalUpdate(
  task: import("./state").TaskEntry,
  changeName: string,
  comments: string,
): Promise<UpdateArtifactResult> {
  return runUpdateArtifact(task, changeName, STAGE_CONFIG.proposal, comments);
}