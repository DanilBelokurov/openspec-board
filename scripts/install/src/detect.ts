import { readSettings } from "./settings";

export function detectInstalledMcpServers(settingsFilePath: string): string[] {
  let settings: ReturnType<typeof readSettings>;
  try {
    settings = readSettings(settingsFilePath);
  } catch (_error) {
    return [];
  }

  const servers = settings.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return [];
  }
  return Object.keys(servers);
}

export function isMcpInstalled(
  detectedKeys: readonly string[],
  targetKey: string,
): boolean {
  return detectedKeys.includes(targetKey);
}