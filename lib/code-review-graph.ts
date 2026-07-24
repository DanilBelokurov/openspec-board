/**
 * Code-review-graph pipeline driver. The user adds repos as
 * submodules via the Settings panel; once `git submodule add`
 * succeeds we kick off a two-step pipeline via the
 * `mcp__code-review-graph` MCP server, talking to it through
 * `gigacode`:
 *
 *   1. `templates/code-graph-review/build-graph.md` — calls
 *      `mcp__code-review-graph__build_or_update_graph_tool`
 *      to index the repo, then
 *      `mcp__code-review-graph__get_architecture_overview_tool`
 *      for a sanity read. Without the second call the sdd-board
 *      can't tell the build actually produced something
 *      indexable.
 *
 *   2. `templates/code-graph-review/visualize-graph.md` — same
 *      architecture-overview call, this time wrapped and
 *      emitted as a single JSON document on stdout so the log
 *      file captures a machine-readable snapshot of the graph.
 *
 * A separate watcher (lib/watcher.ts) flips the exit-code field
 * on each step as it dies, and chains step 2 on after step 1
 * exits with code 0. The sdd-board UI marks the graph as
 * "built" only after step 2 exits with code 0.
 *
 * Why gigacode (and not a plain `uvx code-review-graph build …`):
 * the MCP server is already running in this environment and the
 * gigacode subprocess is what gets routed to it. Driving the
 * graph through the same LLM-driven pipeline that produces
 * proposal.md / design.md etc. keeps the build extensible
 * (an LLM can recover from a partial failure, retry a sub-
 * step, etc.) and lets us log the prompt for post-mortem.
 */

import fs from "fs/promises";
import path from "path";
import { spawnDetachedWithLog, spawnGigacodeWithLog, ensureLogDir } from "./process-logger";

interface SpawnBuildResult {
  pid: number | null;
  logFile: string;
  error?: string;
}

/**
 * Ensure the parent directory of a repo log file exists.
 * `ensureLogDir()` only creates `.sdd-board/logs/`; the per-repo
 * log files live one level deeper at `.sdd-board/logs/repos/`.
 */
async function ensureRepoLogDir(): Promise<void> {
  await ensureLogDir();
  await fs.mkdir(path.join(process.cwd(), ".sdd-board", "logs", "repos"), {
    recursive: true,
  });
}

/**
 * The code-review-graph MCP tools walk a git working tree. The
 * submodules live under `<cwd>/repos/<name>/` where `<cwd>` is
 * the sdd-board project's own working directory (the same place
 * `.sdd-board/` lives in), NOT the openspec store. Keeping both
 * repos/ and graphs/ inside the ssd-board project means the
 * graph index sits next to the tool that drives it.
 */
function repoPath(repoName: string): string {
  return path.join(process.cwd(), "repos", repoName);
}

/**
 * `<cwd>/graphs/<name>/` — sibling of repos/, where the MCP
 * tool writes its SQLite + symbol table by default.
 */
function dataDir(repoName: string): string {
  return path.join(process.cwd(), "graphs", repoName);
}

const BUILD_PROMPT_TEMPLATE_PATH = path.join(
  process.cwd(),
  "templates",
  "code-graph-review",
  "build-graph.md",
);
const VISUALIZE_PROMPT_TEMPLATE_PATH = path.join(
  process.cwd(),
  "templates",
  "code-graph-review",
  "visualize-graph.md",
);

const templateCache = new Map<
  string,
  { mtimeMs: number; content: string }
>();

async function loadTemplate(absolutePath: string): Promise<string> {
  const stat = await fs.stat(absolutePath);
  const cached = templateCache.get(absolutePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.content;
  const content = await fs.readFile(absolutePath, "utf-8");
  templateCache.set(absolutePath, { mtimeMs: stat.mtimeMs, content });
  return content;
}

async function loadBuildPrompt(repoName: string): Promise<string> {
  const tpl = await loadTemplate(BUILD_PROMPT_TEMPLATE_PATH);
  return tpl
    .replace(/\{repoName\}/g, repoName)
    .replace(/\{repoPath\}/g, repoPath(repoName))
    .replace(/\{dataDir\}/g, dataDir(repoName));
}

async function loadVisualizePrompt(repoName: string): Promise<string> {
  const tpl = await loadTemplate(VISUALIZE_PROMPT_TEMPLATE_PATH);
  return tpl
    .replace(/\{repoName\}/g, repoName)
    .replace(/\{repoPath\}/g, repoPath(repoName))
    .replace(/\{dataDir\}/g, dataDir(repoName));
}

export function buildLogPath(repoName: string): string {
  return `.sdd-board/logs/repos/${repoName}.graph-build.log`;
}

export function visualizeLogPath(repoName: string): string {
  return `.sdd-board/logs/repos/${repoName}.graph-visualize.log`;
}

/**
 * Spawn the build step. The spawned process is `gigacode
 * --prompt <built-from-build-graph.md> --approval-mode=auto-edit
 * --add-dir <cwd>` with the prompt loaded from the template
 * file. The gigacode LLM agent is responsible for invoking
 * `mcp__code-review-graph__build_or_update_graph_tool` and
 * `mcp__code-review-graph__get_architecture_overview_tool`
 * (in that order, per the template).
 */
export async function spawnCodeReviewGraphBuild(
  repoName: string,
): Promise<SpawnBuildResult> {
  await ensureRepoLogDir();
  const logFile = buildLogPath(repoName);
  let prompt: string;
  try {
    prompt = await loadBuildPrompt(repoName);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`code-review-graph build: cannot load prompt:`, message);
    return { pid: null, logFile, error: message };
  }
  // Persist the full prompt into the log file BEFORE the spawn so
  // a post-mortem can see what the LLM was asked. The gigacode
  // stdout/stderr is appended to the same file (spawnDetached
  // opens the file in append mode).
  await fs.writeFile(
    logFile,
    [
      `# gigacode (code-review-graph build) for ${repoName}`,
      `# repo:  ${repoPath(repoName)}`,
      `# data:  ${dataDir(repoName)}`,
      `# add-dir: ${process.cwd()}`,
      `# approval-mode: auto-edit`,
      "# prompt:",
      prompt,
      "",
    ].join("\n"),
    { flag: "w" },
  );

  let pid: number | null = null;
  try {
    const result = spawnGigacodeWithLog({
      argv: ["--prompt", prompt],
      logFile,
      header: `code-review-graph build for ${repoName}`,
      addDir: process.cwd(),
      approvalMode: "auto-edit",
    });
    pid = result.pid || null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`code-review-graph build spawn threw:`, message);
    return { pid: null, logFile, error: message };
  }
  if (pid == null) {
    return { pid: null, logFile, error: "Не удалось получить PID gigacode" };
  }
  return { pid, logFile };
}

/**
 * Spawn the visualize step. The spawned process is `gigacode
 * --prompt <built-from-visualize-graph.md>` and the template
 * tells the LLM to call
 * `mcp__code-review-graph__get_architecture_overview_tool` and
 * emit the result as a single JSON document on stdout. That
 * stdout is appended to the same log file by the spawn helper.
 */
export async function spawnCodeReviewGraphVisualize(
  repoName: string,
): Promise<SpawnBuildResult> {
  await ensureRepoLogDir();
  const logFile = visualizeLogPath(repoName);
  let prompt: string;
  try {
    prompt = await loadVisualizePrompt(repoName);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`code-review-graph visualize: cannot load prompt:`, message);
    return { pid: null, logFile, error: message };
  }
  await fs.writeFile(
    logFile,
    [
      `# gigacode (code-review-graph visualize) for ${repoName}`,
      `# repo:  ${repoPath(repoName)}`,
      `# data:  ${dataDir(repoName)}`,
      `# add-dir: ${process.cwd()}`,
      `# approval-mode: auto-edit`,
      "# prompt:",
      prompt,
      "",
    ].join("\n"),
    { flag: "w" },
  );

  let pid: number | null = null;
  try {
    const result = spawnGigacodeWithLog({
      argv: ["--prompt", prompt],
      logFile,
      header: `code-review-graph visualize for ${repoName}`,
      addDir: process.cwd(),
      approvalMode: "auto-edit",
    });
    pid = result.pid || null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`code-review-graph visualize spawn threw:`, message);
    return { pid: null, logFile, error: message };
  }
  if (pid == null) {
    return { pid: null, logFile, error: "Не удалось получить PID gigacode" };
  }
  return { pid, logFile };
}