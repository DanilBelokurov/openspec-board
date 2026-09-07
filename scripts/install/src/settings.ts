import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWriteJson } from "./atomic-write";

export interface McpServerEntry {
  command?: string;
  args?: string[];
  type?: string;
  httpUrl?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface SettingsShape {
  mcpServers?: Record<string, McpServerEntry>;
  permissions?: {
    allow?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function getSettingsDir(): string {
  return path.join(os.homedir(), ".gigacode");
}

export function getSettingsPath(): string {
  return path.join(getSettingsDir(), "settings.json");
}

export function settingsPathOverride(filePath?: string): string {
  return filePath ?? getSettingsPath();
}

export function readSettings(filePath: string): SettingsShape {
  if (!existsSync(filePath)) {
    return {};
  }
  const raw = readFileSync(filePath, "utf8").trim();
  if (raw.length === 0) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  ensureObject(parsed, `Файл ${filePath} должен содержать JSON-объект.`);
  return parsed as SettingsShape;
}

export function ensureObject(
  value: unknown,
  message: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
}

export async function writeSettings(
  filePath: string,
  settings: SettingsShape,
): Promise<void> {
  mkdirSync(path.dirname(filePath), { recursive: true });
  await atomicWriteJson(filePath, settings);
}

export async function ensureMcpServersSection(
  filePath: string,
  settings: SettingsShape,
): Promise<SettingsShape> {
  if (settings.mcpServers === undefined) {
    settings.mcpServers = {};
  }
  ensureObject(
    settings.mcpServers,
    `Поле mcpServers в ${filePath} должно быть JSON-объектом.`,
  );
  return settings;
}

export async function ensurePermissionsSection(
  settings: SettingsShape,
): Promise<SettingsShape> {
  if (settings.permissions === undefined) {
    settings.permissions = {};
  }
  ensureObject(
    settings.permissions,
    "Поле permissions в settings.json должно быть JSON-объектом.",
  );
  if (!Array.isArray(settings.permissions.allow)) {
    settings.permissions.allow = [];
  }
  const allow = settings.permissions.allow;
  if (!allow.every((value) => typeof value === "string")) {
    throw new Error("Поле permissions.allow должно содержать только строки.");
  }
  return settings;
}

export function settingsFileExists(filePath: string): boolean {
  return existsSync(filePath);
}