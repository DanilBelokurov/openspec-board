import { existsSync } from "node:fs";
import path from "node:path";
import {
  ensureMcpServersSection,
  readSettings,
  writeSettings,
} from "../settings";
import { registerPermissionTool } from "../permissions";
import { promptForToken } from "../prompts";
import { commandExists } from "../shell";
import { buildNpmProject, cloneRepo } from "../git";
import {
  INSTALLER_INSTRUCTION_SOURCECONTROL_TOKEN,
  MCP_SOURCECONTROL_API_URL,
  MCP_SOURCECONTROL_ENTRY,
  MCP_SOURCECONTROL_LOCAL_DIR,
  MCP_SOURCECONTROL_REPO_URL,
} from "../constants";

export interface InstallSourcecontrolOptions {
  settingsFilePath: string;
  token?: string;
}

export async function installSourcecontrolMcp(
  options: InstallSourcecontrolOptions,
): Promise<boolean> {
  let token = options.token;
  if (!token) {
    token = await promptForToken(
      "Токен sourcecontrol (SC_TOKEN).",
      INSTALLER_INSTRUCTION_SOURCECONTROL_TOKEN,
    );
  }

  if (!commandExists("git")) {
    console.error("Для клонирования MCP sourcecontrol требуется git.");
    return false;
  }
  if (!commandExists("npm")) {
    console.error("Для сборки MCP sourcecontrol требуется npm.");
    return false;
  }
  if (!commandExists("node")) {
    console.error("Для обновления .gigacode/settings.json требуется Node.js.");
    return false;
  }

  const localDir = MCP_SOURCECONTROL_LOCAL_DIR;
  const repoUrl = MCP_SOURCECONTROL_REPO_URL;
  const entry = MCP_SOURCECONTROL_ENTRY;

  if (!cloneRepo(repoUrl, localDir, "sourcecontrol")) return false;
  if (!buildNpmProject(localDir, "sourcecontrol")) return false;

  const entryPath = path.join(localDir, entry);
  if (!existsSync(entryPath)) {
    console.error(`После сборки не найден ${entryPath} — установка остановлена.`);
    return false;
  }

  const settings = readSettings(options.settingsFilePath);
  await ensureMcpServersSection(options.settingsFilePath, settings);
  (settings.mcpServers as Record<string, unknown>).sourcecontrol = {
    command: "node",
    args: [entryPath],
    env: {
      SC_API_URL: MCP_SOURCECONTROL_API_URL,
      SC_TOKEN: token,
    },
  };
  await writeSettings(options.settingsFilePath, settings);

  token = "";
  console.log(`MCP-сервер sourcecontrol добавлен в ${options.settingsFilePath}.`);

  await registerPermissionTool(
    options.settingsFilePath,
    "mcp__sourcecontrol__git_create_pull_request",
  );
  return true;
}