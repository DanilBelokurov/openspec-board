/**
 * Code-review-graph pipeline driver. The user adds repos as
 * submodules via the Settings panel; once `git submodule add`
 * succeeds we kick off a two-step pipeline via the
 * `mcp__code-review-graph` MCP server, talking to it through
 * `gigacode`:
 *
 *   1. `templates/code-graph-review/build-graph.md` — calls
 *      `mcp__code-review-graph__build_or_update_graph_tool` to
 *      index the repo (the tool writes its data dir to
 *      `.code-review-graph/` inside the repo by default — there
 *      is no `data_dir` parameter, the tool's behaviour is fixed)
 *      and then `get_architecture_overview_tool` for a sanity
 *      read so the sdd-board can tell the build actually
 *      produced something indexable.
 *
 *   2. `templates/code-graph-review/wiki-graph.md` — calls
 *      `mcp__code-review-graph__generate_wiki_tool` to produce a
 *      markdown wiki for the freshly-built graph.
 *
 * A separate watcher (lib/watcher.ts) flips the exit-code field
 * on each step as it dies, and chains step 2 on after step 1
 * exits with code 0. The sdd-board UI marks the pipeline as
 * "wiki done" only after step 2 exits with code 0.
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
 * `.sdd-board/` lives in), NOT the openspec store. The graph
 * data itself is written by the tool to `<repoRoot>/.code-review-graph/`
 * (the tool has no `data_dir` parameter — that location is fixed).
 */
function repoPath(repoName: string): string {
  return path.join(process.cwd(), "repos", repoName);
}

const BUILD_PROMPT_TEMPLATE_PATH = path.join(
  process.cwd(),
  "templates",
  "code-graph-review",
  "build-graph.md",
);
const WIKI_PROMPT_TEMPLATE_PATH = path.join(
  process.cwd(),
  "templates",
  "code-graph-review",
  "wiki-graph.md",
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
    .replace(/\{repoPath\}/g, repoPath(repoName));
}

async function loadWikiPrompt(repoName: string): Promise<string> {
  const tpl = await loadTemplate(WIKI_PROMPT_TEMPLATE_PATH);
  return tpl
    .replace(/\{repoName\}/g, repoName)
    .replace(/\{repoPath\}/g, repoPath(repoName));
}

export function buildLogPath(repoName: string): string {
  return `.sdd-board/logs/repos/${repoName}.graph-build.log`;
}

export function wikiLogPath(repoName: string): string {
  return `.sdd-board/logs/repos/${repoName}.graph-wiki.log`;
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
 * Spawn the wiki step. The spawned process is `gigacode
 * --prompt <built-from-wiki-graph.md>` and the template tells
 * the LLM to call
 * `mcp__code-review-graph__generate_wiki_tool` on the repo from
 * the freshly-built graph. Replaces the previous visualize
 * step (which called `get_architecture_overview_tool` and
 * re-emitted it as JSON).
 */
export async function spawnCodeReviewGraphWiki(
  repoName: string,
): Promise<SpawnBuildResult> {
  await ensureRepoLogDir();
  const logFile = wikiLogPath(repoName);
  let prompt: string;
  try {
    prompt = await loadWikiPrompt(repoName);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`code-review-graph wiki: cannot load prompt:`, message);
    return { pid: null, logFile, error: message };
  }
  await fs.writeFile(
    logFile,
    [
      `# gigacode (code-review-graph wiki) for ${repoName}`,
      `# repo:  ${repoPath(repoName)}`,
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
      header: `code-review-graph wiki for ${repoName}`,
      addDir: process.cwd(),
      approvalMode: "auto-edit",
    });
    pid = result.pid || null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`code-review-graph wiki spawn threw:`, message);
    return { pid: null, logFile, error: message };
  }
  if (pid == null) {
    return { pid: null, logFile, error: "Не удалось получить PID gigacode" };
  }
  return { pid, logFile };
}
