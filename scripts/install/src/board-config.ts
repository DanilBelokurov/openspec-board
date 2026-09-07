import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { atomicWriteJson } from "./atomic-write";
import { print } from "./print";

export const BOARD_CONFIG_PATH = path.join(".sdd-board", "config.json");

export interface BoardConfigUpdate {
  openspecDir?: string;
  sddStoreName?: string;
}

export interface UpdateBoardConfigResult {
  path: string;
  found: boolean;
  changed: boolean;
  previous: Record<string, unknown>;
  current: Record<string, unknown>;
}

export function resolveBoardConfigPath(boardRoot: string): string {
  return path.join(boardRoot, BOARD_CONFIG_PATH);
}

export async function updateBoardConfig(
  boardRoot: string,
  updates: BoardConfigUpdate,
): Promise<UpdateBoardConfigResult> {
  const configPath = resolveBoardConfigPath(boardRoot);

  if (!existsSync(configPath)) {
    print.warn(`config.json не найден: ${configPath}`);
    return {
      path: configPath,
      found: false,
      changed: false,
      previous: {},
      current: {},
    };
  }

  let current: Record<string, unknown>;
  try {
    current = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    print.error(`Невалидный JSON в ${configPath}: ${message}`);
    return {
      path: configPath,
      found: true,
      changed: false,
      previous: {},
      current: {},
    };
  }

  const previous: Record<string, unknown> = { ...current };
  let changed = false;
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (current[key] === value) continue;
    current[key] = value;
    changed = true;
  }

  if (!changed) {
    print.dim(`config.json уже содержит нужные значения — пропускаю.`);
    return { path: configPath, found: true, changed: false, previous, current };
  }

  await atomicWriteJson(configPath, current);
  const changedKeys = Object.keys(updates).filter(
    (k) => updates[k as keyof BoardConfigUpdate] !== undefined && previous[k] !== current[k],
  );
  print.success(`config.json обновлён: ${changedKeys.join(", ")}`);
  return { path: configPath, found: true, changed: true, previous, current };
}