import {
  ensureMcpServersSection,
  readSettings,
  writeSettings,
} from "../settings";
import { registerPermissionTool } from "../permissions";
import { promptForToken } from "../prompts";
import { commandExists } from "../shell";
import { INSTALLER_INSTRUCTION_JIRA_TOKEN } from "../constants";

export interface InstallJiraOptions {
  settingsFilePath: string;
  token?: string;
}

export async function installJiraMcp(options: InstallJiraOptions): Promise<boolean> {
  let token = options.token;
  if (!token) {
    token = await promptForToken(
      "Токен Jira (x-jira-token).",
      INSTALLER_INSTRUCTION_JIRA_TOKEN,
    );
  }

  if (!commandExists("node")) {
    console.error("Для обновления .gigacode/settings.json требуется Node.js.");
    return false;
  }

  const settings = readSettings(options.settingsFilePath);
  await ensureMcpServersSection(options.settingsFilePath, settings);
  (settings.mcpServers as Record<string, unknown>)["jira-mcp"] = {
    type: "streamable-http",
    httpUrl: "https://api.sbertrack.sberbank.ru/jira/mcp",
    headers: {
      "x-jira-token": token,
    },
  };
  await writeSettings(options.settingsFilePath, settings);

  token = "";
  console.log(`MCP-сервер jira-mcp добавлен в ${options.settingsFilePath}.`);

  await registerPermissionTool(options.settingsFilePath, "mcp__jira-mcp__add_labels");
  return true;
}