import fs from "fs/promises";
import path from "path";
import { DEFAULT_MODE, isBoardModeId, type BoardModeId } from "./modes";

export const DEFAULT_BRANCH = "master";

export interface AppConfig {
  openspecDir: string;
  mode: BoardModeId;
  // Name of the main branch in the openspecDir git repo. The proposal
  // creation flow pulls this branch from origin and creates feature
  // branches off it.
  defaultBranch: string;
}

const CONFIG_DIR = path.join(process.cwd(), ".sdd-board");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: AppConfig = {
  openspecDir: "",
  mode: DEFAULT_MODE,
  defaultBranch: DEFAULT_BRANCH,
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
    return {
      openspecDir: parsed.openspecDir ?? "",
      mode,
      defaultBranch,
    };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return DEFAULT_CONFIG;
    }
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
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    CONFIG_FILE,
    JSON.stringify(next, null, 2) + "\n",
    "utf-8",
  );
  return next;
}