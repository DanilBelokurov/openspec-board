import {
  ensureMcpServersSection,
  ensurePermissionsSection,
  readSettings,
  writeSettings,
  type McpServerEntry,
  type SettingsShape,
} from "./settings";
import { MCP_CATALOG_ENTRIES } from "./catalog";
import { print } from "./print";

export async function registerPermissionTool(
  settingsFilePath: string,
  tool: string,
): Promise<void> {
  const settings = readSettings(settingsFilePath);
  await ensurePermissionsSection(settings);
  const allow = settings.permissions!.allow!;
  if (!allow.includes(tool)) {
    allow.push(tool);
  }
  await writeSettings(settingsFilePath, settings);
  print.success(`Разрешение ${tool} добавлено в permissions.allow.`);
}

export interface ReconcileResult {
  changed: boolean;
  rewrites: Array<{ from: string; to: string }>;
  removedDuplicates: string[];
}

export async function reconcileMcpServerKeys(
  settingsFilePath: string,
): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    changed: false,
    rewrites: [],
    removedDuplicates: [],
  };

  let settings: SettingsShape;
  try {
    settings = readSettings(settingsFilePath);
  } catch (_error) {
    return result;
  }
  const servers = settings.mcpServers;
  if (!servers) {
    return result;
  }

  for (const plan of MCP_CATALOG_ENTRIES) {
    if (!plan.matcher) continue;
    const foreignKeys = Object.keys(servers).filter(
      (key) => key !== plan.settingsKey && plan.matcher!(servers[key] as McpServerEntry),
    );
    if (foreignKeys.length === 0) continue;

    if (Object.prototype.hasOwnProperty.call(servers, plan.settingsKey)) {
      for (const key of foreignKeys) {
        delete servers[key];
        result.removedDuplicates.push(key);
        result.changed = true;
        print.dim(`[reconcile] удалён дубль mcpServers["${key}"]`);
      }
      continue;
    }

    const [promotedKey, ...staleKeys] = foreignKeys;
    servers[plan.settingsKey] = servers[promotedKey];
    for (const key of staleKeys) {
      delete servers[key];
      result.removedDuplicates.push(key);
      result.changed = true;
    }
    delete servers[promotedKey];
    result.changed = true;
    result.rewrites.push({ from: promotedKey, to: plan.settingsKey });
    print.dim(
      `[reconcile] mcpServers["${promotedKey}"] → mcpServers["${plan.settingsKey}"]`,
    );
  }

  if (result.changed) {
    await writeSettings(settingsFilePath, settings);
  }
  return result;
}

export interface SyncPermissionsResult {
  changed: boolean;
  added: string[];
}

export async function syncRequiredPermissions(
  settingsFilePath: string,
): Promise<SyncPermissionsResult> {
  const result: SyncPermissionsResult = { changed: false, added: [] };
  let settings: SettingsShape;
  try {
    settings = readSettings(settingsFilePath);
  } catch (_error) {
    return result;
  }
  const servers = settings.mcpServers;
  if (!servers) return result;

  const desired: string[] = [];
  for (const row of MCP_CATALOG_ENTRIES) {
    if (!Object.prototype.hasOwnProperty.call(servers, row.settingsKey)) continue;
    for (const tool of row.permissions) desired.push(tool);
  }
  if (desired.length === 0) return result;

  await ensurePermissionsSection(settings);
  const allow = settings.permissions!.allow!;
  const present = new Set(allow);
  for (const tool of desired) {
    if (present.has(tool)) continue;
    allow.push(tool);
    present.add(tool);
    result.added.push(tool);
  }
  if (result.added.length > 0) {
    await writeSettings(settingsFilePath, settings);
    result.changed = true;
    print.dim(`[permissions] добавлены: ${result.added.join(", ")}`);
  }
  return result;
}

export { ensureMcpServersSection };