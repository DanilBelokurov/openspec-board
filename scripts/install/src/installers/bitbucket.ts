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
  INSTALLER_INSTRUCTION_BITBUCKET_TOKEN,
  MCP_BITBUCKET_API_URL,
  MCP_BITBUCKET_ENTRY,
  MCP_BITBUCKET_LOCAL_DIR,
  MCP_BITBUCKET_PERMISSION_TOOL,
  MCP_BITBUCKET_REPO_URL,
  MCP_BITBUCKET_SUBDIR,
} from "../constants";
import { print } from "../print";

export interface InstallBitbucketOptions {
  settingsFilePath: string;
  token?: string;
}

export async function installBitbucketMcp(options: InstallBitbucketOptions): Promise<boolean> {
  let token = options.token;
  if (!token) {
    token = await promptForToken(
      "Токен bitbucket (BITBUCKET_TOKEN).",
      INSTALLER_INSTRUCTION_BITBUCKET_TOKEN,
    );
  }

  if (!commandExists("git")) {
    print.error("Для клонирования MCP bitbucket требуется git.");
    return false;
  }
  if (!commandExists("npm")) {
    print.error("Для сборки MCP bitbucket требуется npm.");
    return false;
  }
  if (!commandExists("node")) {
    print.error("Для обновления .gigacode/settings.json требуется Node.js.");
    return false;
  }

  const repoUrl = MCP_BITBUCKET_REPO_URL;
  const localDir = MCP_BITBUCKET_LOCAL_DIR;
  const buildSubdir = MCP_BITBUCKET_SUBDIR === "." ? "" : MCP_BITBUCKET_SUBDIR;
  const buildDir = buildSubdir ? path.join(localDir, buildSubdir) : localDir;
  const entryRel = buildSubdir
    ? path.join(buildSubdir, MCP_BITBUCKET_ENTRY)
    : MCP_BITBUCKET_ENTRY;
  const entryPath = path.join(localDir, entryRel);

  if (repoUrl.startsWith("placeholder/")) {
    print.error(
      "MCP_BITBUCKET_REPO_URL не настроен (значение placeholder). Укажите реальный URL в переменной окружения или в шапке скрипта и повторите установку.",
    );
    return false;
  }

  if (!cloneRepo(repoUrl, localDir, "bitbucket")) return false;
  if (!buildNpmProject(buildDir, "bitbucket")) return false;

  if (!existsSync(entryPath)) {
    print.error(`После сборки не найден ${entryPath} — установка остановлена.`);
    return false;
  }

  const settings = readSettings(options.settingsFilePath);
  await ensureMcpServersSection(options.settingsFilePath, settings);
  (settings.mcpServers as Record<string, unknown>).bitbucket = {
    command: "node",
    args: [entryPath],
    env: {
      BITBUCKET_URL: MCP_BITBUCKET_API_URL,
      BITBUCKET_TOKEN: token,
    },
  };
  await writeSettings(options.settingsFilePath, settings);

  token = "";
  print.success(`MCP-сервер bitbucket добавлен в ${options.settingsFilePath}.`);

  await registerPermissionTool(options.settingsFilePath, MCP_BITBUCKET_PERMISSION_TOOL);
  return true;
}