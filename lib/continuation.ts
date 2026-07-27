import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { readConfig } from "./config";
import { readState, updateTask } from "./state";
import {
  ensureLogDir,
  processLogPath,
  processPromptPath,
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
// 'Сделать pull request' uses its own template — PRs are not
// an OpenSpec artefact (no openspec instructions <art> for them),
// so the prompt is hand-written to drive the MCP `git` server's
// `create_pull_request` tool against the already-pushed feature
// branch. Base branch is substituted from config.defaultBranch.
const CREATE_PULL_REQUEST_TEMPLATE_PATH = path.join(
  process.cwd(),
  "templates",
  "git",
  "create-pull-request-template.md",
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
const loadCreatePullRequestPromptTemplate = () =>
  loadTemplate(CREATE_PULL_REQUEST_TEMPLATE_PATH);
const TDD_GREEN_PROMPT_TEMPLATE_PATH = path.join(
  process.cwd(),
  "templates",
  "spec-driven",
  "tdd-green-prompt-template.md",
);
const loadTddGreenPromptTemplate = () =>
  loadTemplate(TDD_GREEN_PROMPT_TEMPLATE_PATH);
const TDD_RED_PROMPT_TEMPLATE_PATH = path.join(
  process.cwd(),
  "templates",
  "spec-driven",
  "tdd-red-prompt-template.md",
);
const loadTddRedPromptTemplate = () =>
  loadTemplate(TDD_RED_PROMPT_TEMPLATE_PATH);
const TDD_RED_UPDATE_PROMPT_TEMPLATE_PATH = path.join(
  process.cwd(),
  "templates",
  "spec-driven",
  "tdd-red-update-prompt-template.md",
);
const loadTddRedUpdatePromptTemplate = () =>
  loadTemplate(TDD_RED_UPDATE_PROMPT_TEMPLATE_PATH);

// ============================================================================
// Generic artifact pipeline
// ============================================================================

/**
 * Plan-stage readiness: `openspec instructions tasks` resolves
 * `tasks.md` to a per-service subdirectory under the change
 * folder, e.g. `tasks/article-service/tasks.md`, mirroring the
 * "level-3 heading = service" structure the analyst writes
 * into `design.md`. The plain `isStageReady` check at
 * `<change>/tasks.md` would never see that file, so the
 * "Подтверждаю" button would never appear even after gigacode
 * has finished writing.
 *
 * This helper accepts the convention: tasks.md can be either
 * at the change folder root (single-service projects) or
 * under any subdirectory. The search is depth-limited to 4
 * so a pathological change folder with thousands of files
 * can't lock up the page render.
 */
export async function isPlanTasksReady(
  worktree: string,
  changeName: string,
): Promise<boolean> {
  const changePath = path.join(
    worktree,
    "openspec",
    "changes",
    changeName,
  );
  // Direct match at the change folder root.
  if (await exists(path.join(changePath, "tasks.md"))) return true;
  // Recursive search through subdirectories.
  return await findTasksMdRecursive(changePath, 4);
}

/**
 * Recursively search `dir` for a `tasks.md` file. Bounded to
 * `maxDepth` levels to keep the page render cheap on
 * pathological change folders. Skips dotfiles/dotdirs (the
 * rest of the tree-walker in this codebase also skips them
 * via SKIP_DOTFILES).
 */
async function findTasksMdRecursive(
  dir: string,
  maxDepth: number,
): Promise<boolean> {
  if (maxDepth <= 0) return false;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === "tasks.md") return true;
    if (entry.isDirectory()) {
      if (await findTasksMdRecursive(full, maxDepth - 1)) return true;
    }
  }
  return false;
}

/**
 * Read the existing plan-stage artifact for the update
 * prompt. The openspec-instructions `tasks` resolvedOutputPath
 * puts `tasks.md` under a per-service subdirectory, so the
 * plain `readArtifactForPrompt` (which targets
 * `<change>/<artifactSubpath>`) wouldn't see the file.
 *
 * Returns the concatenated text of any `tasks.md` files
 * found under the change folder, or `""` if none exist (the
 * gigacode update prompt treats that as "no prior content",
 * which is the right behaviour for the first run after a
 * failed previous attempt).
 */
export async function readPlanArtifact(
  worktree: string,
  changeName: string,
): Promise<string> {
  const changePath = path.join(
    worktree,
    "openspec",
    "changes",
    changeName,
  );
  const files: string[] = [];
  await collectTasksMdFiles(changePath, files, 4);
  if (files.length === 0) return "";
  const parts: string[] = [];
  for (const f of files) {
    try {
      const content = await fs.readFile(f, "utf-8");
      // Use the relative path from the change folder as the
      // delimiter so the LLM can tell which service each
      // tasks.md came from.
      parts.push(
        `--- ${path.relative(changePath, f)} ---\n${content}`,
      );
    } catch {
      /* skip unreadable */
    }
  }
  return parts.join("\n\n");
}

async function collectTasksMdFiles(
  dir: string,
  out: string[],
  maxDepth: number,
): Promise<void> {
  if (maxDepth <= 0) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === "tasks.md") {
      out.push(full);
    } else if (entry.isDirectory()) {
      await collectTasksMdFiles(full, out, maxDepth - 1);
    }
  }
}

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
  instructionsArtifact: "proposal" | "specs" | "design" | "adr" | "tasks";
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
  adr: {
    stage: "adr",
    instructionsArtifact: "adr",
    artifactSubpath: "adr.md",
  },
  // Developer-mode "План" stage: same openspec-instructions +
  // gigacode --prompt shape as design / adr, but the artifact is
  // tasks.md. The change folder already exists on the tracked
  // branch (that's how the task was auto-discovered into the
  // backlog), so there is no `openspec new change` step here — the
  // /start endpoint just sets the worktree path to the openspec
  // repo root and lets the auto-trigger pick this up on the next
  // render.
  plan: {
    stage: "plan",
    instructionsArtifact: "tasks",
    artifactSubpath: "tasks.md",
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
 *
 * Note: there is no proposal-stage spawn here. Step 1
 * (`openspec new change`) is owned by POST /api/changes — it
 * runs synchronously after the worktree is created. The watcher
 * only drives step 2+ (artifact generation, commits are gated).
 */
export async function triggerContinueIfNeeded(
  _openspecDir: string,
): Promise<string[]> {
  const state = await readState();
  const triggered: string[] = [];
  await ensureLogDir();

  for (const [_, task] of Object.entries(state.tasks)) {
    if (!task.openspecWorktreePath) continue;
    const config = STAGE_CONFIG[task.stage];
    if (!config) continue;
    // state.tasks keys are composite `${mode}:${tag}` — never use
    // them as a path segment or as the second arg of updateTask.
    // The change folder lives at `<worktree>/openspec/changes/<tag>/`,
    // so the bare tag is what we need everywhere below.
    const tag = task.summary.changeName;
    const changePath = path.join(
      task.openspecWorktreePath,
      "openspec",
      "changes",
      tag,
    );
    if (!(await exists(changePath))) continue;

    const ready = await isStageReady(
      task.openspecWorktreePath,
      tag,
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
      tag,
      changePath,
      config,
    );
    if (spawned) triggered.push(tag);
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
    case "adr":
      return task.adrCreatePid ?? null;
    case "plan":
      return task.planCreatePid ?? null;
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
    const errField = ((): keyof import("./state").TaskEntry => {
      switch (config.stage) {
        case "proposal":
          return "commitError";
        case "plan":
          return "planCreateError";
        default:
          // Pre-existing behavior: design/adr/delta-spec all share
          // deltaSpecCommitError. A future refactor can split these
          // out per stage.
          return "deltaSpecCommitError";
      }
    })();
    await updateTask(task.mode, changeName, {
      [errField]: `openspec instructions: ${(e as Error).message}`,
    } as Partial<import("./state").TaskEntry>);
    return false;
  }

  const template = await loadCreateArtifactPromptTemplate();
  const prompt = template.replace("{json}", instructionsJson);

  const logFile = processLogPath(changeName, "continue", config.stage);
  const promptFile = processPromptPath(changeName, "continue", config.stage);
  await fs.writeFile(promptFile, prompt, { flag: "w" });
  await fs.writeFile(
    logFile,
    [
      `# gigacode --prompt (${config.stage} create) for ${changeName}`,
      `# add-dir: ${worktree}`,
      `# approval-mode: auto-edit`,
      `# argv: gigacode --prompt <prompt> --approval-mode=auto-edit --add-dir ${worktree}`,
      `# prompt-file: ${promptFile}`,
      `# prompt-length: ${prompt.length} chars`,
      `# openspec instructions output-length: ${instructionsJson.length} chars`,
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
        task.mode,
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
      task.mode,
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

// ============================================================================
// TDD-implement pipeline (developer-mode child tasks in "develop")
// ============================================================================

/**
 * Spawn the per-service TDD `gigacode --prompt` run inside the
 * code-repo worktree. Distinct from `spawnCreateArtifactGigacode`
 * above because:
 *   - cwd is the code-repo worktree (not the openspec worktree)
 *   - the prompt is the TDD-implement template, not the
 *     create/update artifact template
 *   - the state fields written are `greenPhase*` (RED writes
 *     `redPhase*`)
 *   - the {json} placeholder is filled with the parsed
 *     `openspec instructions tasks` JSON, providing the schema
 *     context (rules / template / instruction) to the LLM
 *
 * The GREEN prompt is `templates/spec-driven/tdd-green-prompt-template.md`
 * — same loader pattern as the artifact templates. We pass the
 * TDD iron law in the template body so it's enforced verbatim
 * (LLMs are reliably resistant to "spirit, not letter" of TDD
 * without an explicit, repeated, hard-coded reminder).
 *
 * Returns true on successful spawn, false on error. The
 * spawned gigacode's exit code is captured asynchronously via
 * the standard log-tailing mechanism in lib/process-logger.ts
 * and written to the task's `greenPhaseExitCode` /
 * `greenPhaseExitSignal` fields via `buildGreenPhaseExitPatch`.
 */
export async function runGreenTdd(
  task: import("./state").TaskEntry,
  changeName: string,
): Promise<{ ok: boolean; pid?: number; logFile?: string; error?: string }> {
  // The GREEN phase runs the same fixture as the previous
  // single-phase TDD: read tasks.md, fetch openspec
  // instructions, render the green template, spawn gigacode
  // in the code-repo worktree. The redPhaseBaseSha is not
  // needed here — GREEN just makes the failing tests pass on
  // the existing branch state.
  if (!task.codeWorktreePath) {
    return { ok: false, error: "У задачи не записан codeWorktreePath" };
  }
  if (!task.openspecWorktreePath) {
    return { ok: false, error: "У задачи не записан openspecWorktreePath" };
  }
  if (!task.serviceName) {
    return { ok: false, error: "У задачи не записан serviceName" };
  }
  if (!task.parentTag) {
    return { ok: false, error: "У задачи не записан parentTag" };
  }

  const tasksPath = path.join(
    task.openspecWorktreePath,
    "openspec",
    "changes",
    task.parentTag,
    "tasks",
    task.serviceName,
    "tasks.md",
  );
  let artifactText: string;
  try {
    artifactText = await fs.readFile(tasksPath, "utf-8");
  } catch (e) {
    return {
      ok: false,
      error: `Не удалось прочитать tasks.md для "${task.serviceName}" по пути ${tasksPath}: ${(e as Error).message}`,
    };
  }

  let instructionsJson: string;
  try {
    const { stdout } = await run(
      "openspec",
      [
        "instructions",
        "tasks",
        "--change",
        task.parentTag,
        "--json",
        "--schema",
        SCHEMA,
      ],
      { cwd: task.openspecWorktreePath },
    );
    instructionsJson = stdout;
  } catch (e) {
    return {
      ok: false,
      error: `openspec instructions tasks: ${(e as Error).message}`,
    };
  }

  const template = await loadTddGreenPromptTemplate();
  const prompt = template
    .replace("{tasksPath}", tasksPath)
    .replace("{codeWorktreePath}", task.codeWorktreePath)
    .replace("{openspecWorktreePath}", task.openspecWorktreePath)
    .replace("{json}", instructionsJson);

  const logFile = processLogPath(changeName, "implement", "develop");
  const promptFile = processPromptPath(changeName, "implement", "develop");
  await fs.writeFile(promptFile, prompt, { flag: "w" });
  await fs.writeFile(
    logFile,
    [
      `# gigacode --prompt (TDD GREEN) for ${changeName}`,
      `# tasks: ${tasksPath}`,
      `# code worktree: ${task.codeWorktreePath}`,
      `# openspec worktree: ${task.openspecWorktreePath}`,
      `# argv: gigacode --prompt <prompt> --approval-mode=auto-edit --add-dir ${task.codeWorktreePath}`,
      `# prompt-file: ${promptFile}`,
      `# prompt-length: ${prompt.length} chars`,
      `# openspec-instructions-length: ${instructionsJson.length} chars`,
      "# tasks.md-length:",
      artifactText
        .split("\n")
        .map((l) => `#   ${l}`)
        .join("\n"),
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
      addDir: task.codeWorktreePath,
      approvalMode: "auto-edit",
    });
    pid = result.pid || null;
    const exitHandler = (code: number | null, signal: string | null) =>
      updateTask(
        task.mode,
        changeName,
        buildGreenPhaseExitPatch(code, signal),
      );
    result.promise
      .then(({ exitCode, signal }) => exitHandler(exitCode, signal))
      .catch((e) =>
        console.error(
          `gigacode-green (${changeName}) exit handler error:`,
          e,
        ),
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
    task.mode,
    changeName,
    buildGreenPhaseSpawnPatch(pid, logFile),
  );
  return { ok: true, pid, logFile };
}

function buildGreenPhaseExitPatch(
  exitCode: number | null,
  signal: string | null,
): Partial<import("./state").TaskEntry> {
  return {
    greenPhaseExitCode: exitCode,
    greenPhaseExitSignal: signal,
  };
}

function buildGreenPhaseSpawnPatch(
  pid: number,
  logFile: string,
): Partial<import("./state").TaskEntry> {
  return {
    greenPhasePid: pid,
    greenPhaseStartedAt: new Date().toISOString(),
    greenPhaseLogPath: logFile,
  };
}

/**
 * RED-phase spawn: writes failing tests for each task in
 * `tasks/<service>/tasks.md` and commits each. Does NOT
 * write any production code — that's the GREEN phase's
 * job. Captures the worktree HEAD SHA before the first test
 * commit so the test-diff endpoint can show
 * `git diff redPhaseBaseSha..HEAD` as the review artefact
 * the human clicks "Подтвердить" against.
 */
export async function runRedTdd(
  task: import("./state").TaskEntry,
  changeName: string,
): Promise<{ ok: boolean; pid?: number; logFile?: string; error?: string }> {
  if (!task.codeWorktreePath) {
    return { ok: false, error: "У задачи не записан codeWorktreePath" };
  }
  if (!task.openspecWorktreePath) {
    return { ok: false, error: "У задачи не записан openspecWorktreePath" };
  }
  if (!task.serviceName) {
    return { ok: false, error: "У задачи не записан serviceName" };
  }
  if (!task.parentTag) {
    return { ok: false, error: "У задачи не записан parentTag" };
  }

  const tasksPath = path.join(
    task.openspecWorktreePath,
    "openspec",
    "changes",
    task.parentTag,
    "tasks",
    task.serviceName,
    "tasks.md",
  );
  let artifactText: string;
  try {
    artifactText = await fs.readFile(tasksPath, "utf-8");
  } catch (e) {
    return {
      ok: false,
      error: `Не удалось прочитать tasks.md для "${task.serviceName}" по пути ${tasksPath}: ${(e as Error).message}`,
    };
  }

  let instructionsJson: string;
  try {
    const { stdout } = await run(
      "openspec",
      [
        "instructions",
        "tasks",
        "--change",
        task.parentTag,
        "--json",
        "--schema",
        SCHEMA,
      ],
      { cwd: task.openspecWorktreePath },
    );
    instructionsJson = stdout;
  } catch (e) {
    return {
      ok: false,
      error: `openspec instructions tasks: ${(e as Error).message}`,
    };
  }

  // Capture the worktree HEAD before RED spawns. After RED
  // finishes, `git diff <baseSha>..HEAD` is the exact set of
  // test commits the dev sees in the review card. We
  // deliberately don't pin to a specific commit — RED may
  // make N test commits in one gigacode session, and the
  // review card shows the cumulative diff.
  let baseSha: string | null = null;
  try {
    const { stdout } = await run(
      "git",
      ["-C", task.codeWorktreePath, "rev-parse", "HEAD"],
    );
    baseSha = stdout.trim() || null;
  } catch {
    // Empty worktree (no commits yet) — baseSha stays null
    // and the diff endpoint will diff against the empty tree.
  }

  const template = await loadTddRedPromptTemplate();
  const prompt = template
    .replace("{tasksPath}", tasksPath)
    .replace("{codeWorktreePath}", task.codeWorktreePath)
    .replace("{openspecWorktreePath}", task.openspecWorktreePath)
    .replace("{json}", instructionsJson);

  // RED log file gets its own stage segment so it doesn't
  // collide with the GREEN log on a re-run after approval.
  const logFile = processLogPath(changeName, "red", "develop");
  const promptFile = processPromptPath(changeName, "red", "develop");
  await fs.writeFile(promptFile, prompt, { flag: "w" });
  await fs.writeFile(
    logFile,
    [
      `# gigacode --prompt (TDD RED) for ${changeName}`,
      `# tasks: ${tasksPath}`,
      `# code worktree: ${task.codeWorktreePath}`,
      `# openspec worktree: ${task.openspecWorktreePath}`,
      `# base-sha: ${baseSha ?? "(empty)"}`,
      `# argv: gigacode --prompt <prompt> --approval-mode=auto-edit --add-dir ${task.codeWorktreePath}`,
      `# prompt-file: ${promptFile}`,
      `# prompt-length: ${prompt.length} chars`,
      `# openspec-instructions-length: ${instructionsJson.length} chars`,
      "# tasks.md-length:",
      artifactText
        .split("\n")
        .map((l) => `#   ${l}`)
        .join("\n"),
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
      addDir: task.codeWorktreePath,
      approvalMode: "auto-edit",
    });
    pid = result.pid || null;
    const exitHandler = (code: number | null, signal: string | null) =>
      updateTask(
        task.mode,
        changeName,
        buildRedPhaseExitPatch(code, signal),
      );
    result.promise
      .then(({ exitCode, signal }) => exitHandler(exitCode, signal))
      .catch((e) =>
        console.error(
          `gigacode-red (${changeName}) exit handler error:`,
          e,
        ),
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
    task.mode,
    changeName,
    buildRedPhaseSpawnPatch(pid, logFile, baseSha),
  );
  return { ok: true, pid, logFile };
}

/**
 * RED UPDATE — replay of the RED phase with a user-supplied
 * comment. Spawned by the "переделай тесты с учётом…" pencil
 * flow on the diff card (POST /api/changes/<tag>/implement/update-red).
 * Mirrors runRedTdd except:
 *   - uses `tdd-red-update-prompt-template.md` (the agent
 *     reads the existing tests in the working tree itself —
 *     we don't pass the file contents into the prompt),
 *   - the prompt is fed `{comments}` in place of having
 *     `redPhaseBaseSha` referenced (no SHA context needed:
 *     the working tree is the source of truth),
 *   - state fields written are `redPhaseUpdate*` (not
 *     `redPhase*`), keeping the original RED run's signal
 *     intact for the "RED-фаза" process card.
 *   - `redPhaseUpdateComments` is set to the user's comment
 *     so the process card can echo what the agent was asked.
 *
 * No production code, no commit — same Iron Law as the
 * create-side runRedTdd.
 */
export async function runRedUpdateTdd(
  task: import("./state").TaskEntry,
  changeName: string,
  comments: string,
): Promise<{ ok: boolean; pid?: number; logFile?: string; error?: string }> {
  if (!task.codeWorktreePath) {
    return { ok: false, error: "У задачи не записан codeWorktreePath" };
  }
  if (!task.openspecWorktreePath) {
    return { ok: false, error: "У задачи не записан openspecWorktreePath" };
  }
  if (!task.serviceName) {
    return { ok: false, error: "У задачи не записан serviceName" };
  }
  if (!task.parentTag) {
    return { ok: false, error: "У задачи не записан parentTag" };
  }

  const tasksPath = path.join(
    task.openspecWorktreePath,
    "openspec",
    "changes",
    task.parentTag,
    "tasks",
    task.serviceName,
    "tasks.md",
  );
  let artifactText: string;
  try {
    artifactText = await fs.readFile(tasksPath, "utf-8");
  } catch (e) {
    return {
      ok: false,
      error: `Не удалось прочитать tasks.md для "${task.serviceName}" по пути ${tasksPath}: ${(e as Error).message}`,
    };
  }

  let instructionsJson: string;
  try {
    const { stdout } = await run(
      "openspec",
      [
        "instructions",
        "tasks",
        "--change",
        task.parentTag,
        "--json",
        "--schema",
        SCHEMA,
      ],
      { cwd: task.openspecWorktreePath },
    );
    instructionsJson = stdout;
  } catch (e) {
    return {
      ok: false,
      error: `openspec instructions tasks: ${(e as Error).message}`,
    };
  }

  const template = await loadTddRedUpdatePromptTemplate();
  const prompt = template
    .replace("{tasksPath}", tasksPath)
    .replace("{codeWorktreePath}", task.codeWorktreePath)
    .replace("{openspecWorktreePath}", task.openspecWorktreePath)
    .replace("{comments}", comments)
    .replace("{json}", instructionsJson);

  // Same naming as the create-side red run, but the suffix
  // makes it obvious in `.sdd-board/logs/` which process
  // was the update.
  const logFile = processLogPath(changeName, "red", "develop-update");
  await fs.writeFile(
    logFile,
    [
      `# gigacode --prompt (TDD RED UPDATE) for ${changeName}`,
      `# tasks: ${tasksPath}`,
      `# code worktree: ${task.codeWorktreePath}`,
      `# openspec worktree: ${task.openspecWorktreePath}`,
      `# argv: gigacode --prompt <prompt> --approval-mode=auto-edit --add-dir ${task.codeWorktreePath}`,
      `# prompt-length: ${prompt.length} chars`,
      `# openspec-instructions-length: ${instructionsJson.length} chars`,
      "# tasks.md-length:",
      artifactText
        .split("\n")
        .map((l) => `#   ${l}`)
        .join("\n"),
      "# user comments:",
      ...comments
        .split("\n")
        .map((l) => `#   ${l}`),
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
      addDir: task.codeWorktreePath,
      approvalMode: "auto-edit",
    });
    pid = result.pid || null;
    const exitHandler = (code: number | null, signal: string | null) =>
      updateTask(
        task.mode,
        changeName,
        buildRedPhaseUpdateExitPatch(code, signal),
      );
    result.promise
      .then(({ exitCode, signal }) => exitHandler(exitCode, signal))
      .catch((e) =>
        console.error(
          `gigacode-red-update (${changeName}) exit handler error:`,
          e,
        ),
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
    task.mode,
    changeName,
    buildRedPhaseUpdateSpawnPatch(pid, logFile, comments),
  );
  return { ok: true, pid, logFile };
}

function buildRedPhaseUpdateExitPatch(
  exitCode: number | null,
  signal: string | null,
): Partial<import("./state").TaskEntry> {
  return {
    redPhaseUpdateExitCode: exitCode,
    redPhaseUpdateExitSignal: signal,
  };
}

function buildRedPhaseUpdateSpawnPatch(
  pid: number,
  logFile: string,
  comments: string,
): Partial<import("./state").TaskEntry> {
  return {
    redPhaseUpdatePid: pid,
    redPhaseUpdateStartedAt: new Date().toISOString(),
    redPhaseUpdateLogPath: logFile,
    redPhaseUpdateComments: comments,
  };
}

function buildRedPhaseExitPatch(
  exitCode: number | null,
  signal: string | null,
): Partial<import("./state").TaskEntry> {
  return {
    redPhaseExitCode: exitCode,
    redPhaseExitSignal: signal,
  };
}

function buildRedPhaseSpawnPatch(
  pid: number,
  logFile: string,
  baseSha: string | null,
): Partial<import("./state").TaskEntry> {
  return {
    redPhasePid: pid,
    redPhaseStartedAt: new Date().toISOString(),
    redPhaseLogPath: logFile,
    redPhaseBaseSha: baseSha ?? undefined,
  };
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
    case "adr":
      return {
        adrCreateExitCode: exitCode,
        adrCreateExitSignal: signal,
      };
    case "plan":
      return {
        planCreateExitCode: exitCode,
        planCreateExitSignal: signal,
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
    case "adr":
      return {
        adrCreatePid: pid,
        adrCreateStartedAt: new Date().toISOString(),
        adrCreateLogPath: logFile,
      };
    case "plan":
      return {
        planCreatePid: pid,
        planCreateStartedAt: new Date().toISOString(),
        planCreateLogPath: logFile,
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
  // Skip the commit (and the timestamp write) when there's
  // nothing staged — happens on the second /confirm of the
  // same plan (child tasks live in state, not on disk; the
  // openspec worktree is already clean). Without this, the
  // second call would `git commit` and fail with "nothing to
  // commit, working tree clean", which then trips a 500
  // through the planCommitError surface.
  try {
    const { stdout } = await run("git", [
      "-C",
      worktree,
      "status",
      "--porcelain",
    ]);
    if (stdout.trim() === "") return true;
  } catch {
    // `git status` itself failed (broken repo, etc.). Fall
    // through to `git add` + `git commit` and let those
    // surface the real error.
  }
  const message = buildCommitMessage(task, changeName, stage);
  try {
    await run("git", ["-C", worktree, "add", "."]);
    await run("git", ["-C", worktree, "commit", "-m", message]);
    await updateTask(
      task.mode,
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
      task.mode,
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
      case "adr":
        return {
          adrCommittedAt: ts,
          adrCommitExitCode: 0,
          adrCommitError: undefined,
        };
      case "plan":
        return {
          planCommittedAt: ts,
          planCommitExitCode: 0,
          planCommitError: undefined,
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
    case "adr":
      return {
        adrCommitExitCode: 1,
        adrCommitError: result.error,
      };
    case "plan":
      return {
        planCommitExitCode: 1,
        planCommitError: result.error,
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
          : stage === "adr"
            ? "ADR"
            : stage === "plan"
              ? "plan"
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
  // The plan stage is a special case: the openspec-instructions
  // `tasks` subcommand puts tasks.md under a per-service
  // subdirectory (tasks/<service>/tasks.md, mirroring the
  // design.md service structure), so the simple per-path read
  // wouldn't see it. readPlanArtifact walks the change folder
  // and concatenates every tasks.md it finds, each prefixed
  // with its relative path so the LLM can tell them apart.
  let artifactText: string;
  try {
    artifactText =
      config.stage === "plan"
        ? await readPlanArtifact(worktree, changeName)
        : await readArtifactForPrompt(artifactAbsPath);
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
  const promptFile = processPromptPath(changeName, "update", config.stage);
  await fs.writeFile(promptFile, prompt, { flag: "w" });
  await fs.writeFile(
    logFile,
    [
      `# gigacode --prompt (${config.stage} update) for ${changeName}`,
      `# add-dir: ${worktree}`,
      `# approval-mode: auto-edit`,
      `# argv: gigacode --prompt <prompt> --approval-mode=auto-edit --add-dir ${worktree}`,
      `# prompt-file: ${promptFile}`,
      `# artifact-length: ${artifactText.length} chars`,
      `# comments-length: ${comments.length} chars`,
      `# openspec instructions output-length: ${instructionsJson.length} chars`,
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
        "analyst",
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
    "analyst",
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
  // The 'edit' / 'reopen' pipeline deletes the target stage's
  // artefact before calling us, on purpose — the new write is
  // supposed to start from scratch. A missing file here is the
  // normal "no prior content" case, not an error: gigacode will
  // generate the artefact from scratch. Return an empty string
  // so the {artifact} placeholder in the update template
  // substitutes cleanly instead of throwing ENOENT.
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return "";
    throw e;
  }
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
    case "adr":
      return task.adrUpdatePid ?? null;
    case "plan":
      return task.planUpdatePid ?? null;
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
    case "adr":
      return {
        adrUpdateExitCode: exitCode,
        adrUpdateExitSignal: signal,
      };
    case "plan":
      return {
        planUpdateExitCode: exitCode,
        planUpdateExitSignal: signal,
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
    case "adr":
      return {
        adrUpdatePid: pid,
        adrUpdateStartedAt: ts,
        adrUpdateLogPath: logFile,
        adrUpdateComments: comments,
      };
    case "plan":
      return {
        planUpdatePid: pid,
        planUpdateStartedAt: ts,
        planUpdateLogPath: logFile,
        planUpdateComments: comments,
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
// Pull request — gigacode --prompt that drives the MCP git
// server's `create_pull_request` tool.
// ============================================================================

export interface CreatePullRequestResult {
  ok: boolean;
  pid?: number | null;
  logFile?: string;
  error?: string;
}

/**
 * Spawn the gigacode --prompt run that opens a PR for the
 * already-pushed feature branch. The template
 * (templates/git/create-pull-request-template.md) is hand-written
 * — there's no `openspec instructions pr` artefact, so we don't
 * run that CLI. The template carries the full instructions
 * (read proposal.md / design.md / adr.md / specs/, then call
 * `mcp__git__create_pull_request` and report the URL).
 *
 * `{baseBranch}` in the template is substituted from
 * `config.defaultBranch` here — the trunk of the openspec store
 * repo. We read it once per spawn (no caching) so the analyst's
 * settings dialog edits take effect on the next PR attempt
 * without a server restart.
 *
 * `task.pullRequestPid` is the idempotency key: if a previous run
 * is still alive, the second call refuses. `task.pushedAt` is
 * the gate — the endpoint must ensure the branch is pushed
 * before calling us.
 */
export async function spawnCreatePullRequestGigacode(
  task: import("./state").TaskEntry,
  changeName: string,
  comments: string,
): Promise<CreatePullRequestResult> {
  if (!task.openspecWorktreePath) {
    return { ok: false, error: "Не задан worktree задачи" };
  }
  const worktree = task.openspecWorktreePath;

  if (task.pullRequestPid && isProcessAliveByPid(task.pullRequestPid)) {
    return {
      ok: false,
      error:
        "Создание pull request уже выполняется — дождитесь завершения",
    };
  }

  // Read the feature branch from the worktree. We don't have a
  // stored value for it on the task; the user is expected to have
  // pushed via 'Опубликовать ветку' which the endpoint already
  // captured as pushRemoteUrl / pushedAt.
  const branch = await runGit(worktree, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ])
    .then((r) => r.stdout.trim())
    .catch((e) => "");

  const config = await readConfig();
  const template = await loadCreatePullRequestPromptTemplate();
  const prompt = template
    .replace("{branch}", branch || "(unknown branch)")
    .replace("{baseBranch}", config.defaultBranch || "master")
    .replace("{tag}", changeName)
    .replace("{repoUrl}", task.pushRemoteUrl || "(unknown remote)")
    .replace("{comments}", comments);

  const logFile = processLogPath(changeName, "update", task.stage);
  const promptFile = processPromptPath(changeName, "update", task.stage);
  await fs.writeFile(promptFile, prompt, { flag: "w" });
  await fs.writeFile(
    logFile,
    [
      `# gigacode --prompt (pull request) for ${changeName}`,
      `# add-dir: ${worktree}`,
      `# approval-mode: auto-edit`,
      `# branch: ${branch}`,
      `# base-branch: ${config.defaultBranch || "master"}`,
      `# repo: ${task.pushRemoteUrl ?? "(unknown)"}`,
      `# argv: gigacode --prompt <prompt> --approval-mode=auto-edit --add-dir ${worktree}`,
      `# prompt-file: ${promptFile}`,
      `# comments-length: ${comments.length} chars`,
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
    result.promise
      .then(async ({ exitCode, signal }) => {
        // The PR template instructs gigacode to «Report the
        // resulting PR URL in your final response», so the URL
        // lands somewhere in the captured stdout/stderr (the log
        // file at logFile). Parse it once the process has exited
        // and the log is fully flushed. Only record the URL on
        // successful exit — a failed gigacode run may have
        // surfaced an unrelated URL (e.g. an error page link) we
        // don't want to persist as the canonical PR URL.
        let pullRequestUrl: string | undefined;
        if (exitCode === 0) {
          try {
            const log = await fs.readFile(logFile, "utf-8");
            const match = log.match(
              /https?:\/\/\S+\/(?:pull|merge_requests)\/\d+/,
            );
            if (match) {
              pullRequestUrl = match[0];
            }
          } catch (e) {
            // Log read failure is non-fatal — exitCode is still
            // recorded below, the analyst can still read the log
            // manually to find the URL.
            console.error(
              `gigacode (pull request) log read failed for ${changeName}:`,
              e,
            );
          }
        }
        await updateTask("analyst", changeName, {
          pullRequestExitCode: exitCode,
          pullRequestExitSignal: signal,
          ...(pullRequestUrl ? { pullRequestUrl } : {}),
        });
      })
      .catch((e) =>
        console.error(
          `gigacode (pull request) exit handler error:`,
          e,
        ),
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
  await updateTask("analyst", changeName, {
    pullRequestPid: pid,
    pullRequestStartedAt: new Date().toISOString(),
    pullRequestLogPath: logFile,
  });
  return { ok: true, pid, logFile };
}

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