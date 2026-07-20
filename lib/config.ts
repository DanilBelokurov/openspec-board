import fs from "fs/promises";
import path from "path";
import { DEFAULT_MODE, isBoardModeId, type BoardModeId } from "./modes";

export interface AppConfig {
  openspecDir: string;
  mode: BoardModeId;
}

const CONFIG_DIR = path.join(process.cwd(), ".sdd-board");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: AppConfig = {
  openspecDir: "",
  mode: DEFAULT_MODE,
};

export async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const mode = isBoardModeId(parsed.mode) ? parsed.mode : DEFAULT_MODE;
    return {
      openspecDir: parsed.openspecDir ?? "",
      mode,
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
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    CONFIG_FILE,
    JSON.stringify(next, null, 2) + "\n",
    "utf-8",
  );
  return next;
}