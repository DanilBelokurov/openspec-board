import fs from "fs/promises";
import path from "path";
import { DEFAULT_MODE, isBoardModeId, type BoardModeId } from "./modes";

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
 * `build*` and `visualize*` fields track the two-step
 * `uvx code-review-graph build && uvx code-review-graph visualize`
 * pipeline that runs detached right after `git submodule add`
 * succeeds. The graph is considered "built" only after the
 * visualize step exits with code 0.
 *
 * Shape mirrors the proposal-stage PIDs in TaskEntry (pid /
 * startedAt / exitCode / exitSignal / logPath) so the same
 * watcher.ts + lib/process.ts code can poll them.
 */
export interface RepoConfig {
  url: string;
  branch: string;
  buildPid?: number | null;
  buildStartedAt?: string;
  buildExitCode?: number | null;
  buildExitSignal?: string | null;
  buildLogPath?: string;
  buildError?: string;
  visualizePid?: number | null;
  visualizeStartedAt?: string;
  visualizeExitCode?: number | null;
  visualizeExitSignal?: string | null;
  visualizeLogPath?: string;
  visualizeError?: string;
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
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    CONFIG_FILE,
    JSON.stringify(next, null, 2) + "\n",
    "utf-8",
  );
  return next;
}

/**
 * Patch a single repo's config without touching the other entries.
 * Used by lib/watcher.ts to flip buildExitCode on the repo whose
 * `uvx code-review-graph build` process just died — passing the
 * whole repos map through writeConfig every tick would race with
 * any concurrent user add/remove and is more work than needed.
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
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    CONFIG_FILE,
    JSON.stringify({ ...current, repos: nextRepos }, null, 2) + "\n",
    "utf-8",
  );
  return updated;
}