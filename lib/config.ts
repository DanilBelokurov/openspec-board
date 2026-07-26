import fs from "fs/promises";
import path from "path";
import { DEFAULT_MODE, isBoardModeId, type BoardModeId } from "./modes";
import { atomicWriteFile } from "./atomic-write";

// Pure (no-fs) helpers live in lib/repo-name.ts so client components
// can import them without dragging in fs/promises. Re-exported here
// for server-side callers that prefer one-stop imports.
export {
  isValidRepoName,
  isValidRepoUrl,
  isValidRepoBranch,
  deriveRepoNameFromUrl,
} from "./repo-name";

export const DEFAULT_BRANCH = "master";

/**
 * A git submodule the user tracks alongside the openspecDir repo.
 * The `name` is the key under `repos` in the config — it doubles
 * as the directory name inside `repos/`, so it has to be a safe
 * path segment (kebab-case, no slashes / dots).
 *
 * `build*` and `wiki*` fields track the two-step code-review-graph
 * pipeline that runs detached right after `git submodule add`
 * succeeds:
 *   1. build  — `mcp__code-review-graph__build_or_update_graph_tool`
 *               on the repo (the tool writes its index to
 *               `<repoRoot>/.code-review-graph/`)
 *   2. wiki   — `mcp__code-review-graph__generate_wiki_tool` on
 *               the same repo
 * The pipeline is considered "wiki done" only after step 2 exits
 * with code 0.
 *
 * Shape mirrors the proposal-stage PIDs in TaskEntry (pid /
 * startedAt / exitCode / exitSignal / logPath) so the same
 * watcher.ts + lib/process.ts code can poll them.
 */
export interface RepoConfig {
  url: string;
  branch: string;
  /**
   * Local filesystem path to a working copy of the repo. The
   * dev-mode TDD pipeline creates its worktree inside this
   * directory (under `<localPathParent>/<localPathBasename>.worktrees/<JIRA-ID>/`)
   * and runs `gigacode --prompt` there. Falls back to the
   * submodule convention `<openspecDirParent>/repos/<name>/`
   * (where `name` is the key under `repos` in config) when
   * unset. Set this explicitly when the code repo lives outside
   * the openspec-store parent directory.
   */
  localPath?: string;
  buildPid?: number | null;
  buildStartedAt?: string;
  buildExitCode?: number | null;
  buildExitSignal?: string | null;
  buildLogPath?: string;
  buildError?: string;
  wikiPid?: number | null;
  wikiStartedAt?: string;
  wikiExitCode?: number | null;
  wikiExitSignal?: string | null;
  wikiLogPath?: string;
  wikiError?: string;
}

export interface AppConfig {
  openspecDir: string;
  mode: BoardModeId;
  // Name of the main branch in the openspecDir git repo. The proposal
  // creation flow pulls this branch from origin and creates feature
  // branches off it.
  defaultBranch: string;
  // Tracked git submodules. Key = repo name (kebab-case), value =
  // URL + branch to track. Backed by `git submodule add` + checkout
  // under <openspecDirParent>/repos/<name>/.
  repos?: Record<string, RepoConfig>;
  /**
   * Developer-mode auto-scan cadence, in minutes. The watcher
   * runs `scanChangeProposalsOnBranch(openspecDir,
   * defaultBranch)` every N minutes so the backlog auto-populates
   * without the dev having to click ↻. Only consulted in
   * developer mode (in analyst mode the scan is a one-shot
   * trigger, not periodic). 0 disables auto-scan entirely.
   */
  developerScanIntervalMinutes?: number;
}

const CONFIG_DIR = path.join(process.cwd(), ".sdd-board");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: AppConfig = {
  openspecDir: "",
  mode: DEFAULT_MODE,
  defaultBranch: DEFAULT_BRANCH,
  repos: {},
};

export async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const mode = isBoardModeId(parsed.mode) ? parsed.mode : DEFAULT_MODE;
    const defaultBranch =
      typeof parsed.defaultBranch === "string" &&
      parsed.defaultBranch.trim().length > 0
        ? parsed.defaultBranch.trim()
        : DEFAULT_BRANCH;
    const repos =
      parsed.repos && typeof parsed.repos === "object"
        ? (parsed.repos as Record<string, RepoConfig>)
        : {};
    return {
      openspecDir: parsed.openspecDir ?? "",
      mode,
      defaultBranch,
      repos,
    };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return DEFAULT_CONFIG;
    throw e;
  }
}

export async function writeConfig(
  patch: Partial<AppConfig>,
): Promise<AppConfig> {
  const current = await readConfig();
  const next: AppConfig = { ...current, ...patch };
  // Empty defaultBranch in the patch must NOT clobber the saved value
  // (the SettingsDialog can momentarily hold an empty field while
  // editing). Fall back to the existing value.
  if (typeof next.defaultBranch !== "string" || next.defaultBranch.trim() === "") {
    next.defaultBranch = current.defaultBranch;
  }
  // developerScanIntervalMinutes: 0 is a legitimate value
  // (disable auto-scan), so we don't filter it out. Just normalise
  // undefined / non-numbers to a sane default of 0 (i.e. off).
  if (typeof next.developerScanIntervalMinutes !== "number" || !Number.isFinite(next.developerScanIntervalMinutes)) {
    next.developerScanIntervalMinutes = current.developerScanIntervalMinutes ?? 0;
  }
  // Make sure repos is always present in the on-disk file (even if
  // empty) so callers reading JSON directly see a consistent shape.
  if (!next.repos || typeof next.repos !== "object") next.repos = {};
  // Atomic write — same rationale as writeState in lib/state.ts.
  await atomicWriteFile(
    CONFIG_FILE,
    JSON.stringify(next, null, 2) + "\n",
  );
  return next;
}

/**
 * Patch a single repo's config without touching the other entries.
 * Used by lib/watcher.ts to flip buildExitCode on the repo whose
 * code-review-graph build process just died — passing the whole
 * repos map through writeConfig every tick would race with any
 * concurrent user add/remove and is more work than needed.
 */
export async function updateRepoEntry(
  name: string,
  patch: Partial<RepoConfig>,
): Promise<RepoConfig | null> {
  const current = await readConfig();
  const existing = current.repos?.[name];
  if (!existing) return null;
  const updated: RepoConfig = { ...existing, ...patch };
  const nextRepos = { ...(current.repos ?? {}), [name]: updated };
  // Atomic write — same rationale as writeState in lib/state.ts.
  await atomicWriteFile(
    CONFIG_FILE,
    JSON.stringify({ ...current, repos: nextRepos }, null, 2) + "\n",
  );
  return updated;
}