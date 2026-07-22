import fs from "fs/promises";
import path from "path";
import { DEFAULT_MODE, isBoardModeId, type BoardModeId } from "./modes";

export const DEFAULT_BRANCH = "master";

/**
 * A git submodule the user tracks alongside the openspecDir repo.
 * The `name` is the key under `repos` in the config — it doubles
 * as the directory name inside `repos/`, so it has to be a safe
 * path segment (kebab-case, no slashes / dots).
 */
export interface RepoConfig {
  url: string;
  branch: string;
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
 * kebab-case path-segment validator. Same shape as
 * `lib/tag.ts → isValidOpenspecTag` — lowercase letters, digits,
 * and single dashes; must start with a letter; 1–40 chars; no
 * double dashes. We use it for both the openspec change name and
 * the repo submodule name, so the two cannot collide (repos live
 * under <openspecDirParent>/repos/, change folders live deeper
 * inside openspec/changes/).
 */
export function isValidRepoName(name: string): boolean {
  return (
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) &&
    name.length >= 1 &&
    name.length <= 40
  );
}

/**
 * Lightweight URL validation for the repos panel — accepts http(s)
 * and ssh-style git URLs. Not a full RFC-3986 check; just enough to
 * catch typos before we shell out to `git submodule add`.
 */
export function isValidRepoUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  return /^(https?:\/\/|ssh:\/\/|git@|git:\/\/)/i.test(trimmed);
}

/**
 * Validates a ref-ish branch name. Reject empty / whitespace,
 * control chars, leading dashes, double dots, etc. — anything git
 * itself would refuse.
 */
export function isValidRepoBranch(branch: string): boolean {
  const trimmed = branch.trim();
  if (trimmed.length === 0) return false;
  return /^(?!.*\.\.)(?!\/)(?!.*\/\/)(?!.*@\{)[^\x00-\x20\x7f]+$/.test(
    trimmed,
  );
}