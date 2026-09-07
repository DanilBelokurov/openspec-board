import {
  ensureMcpServersSection,
  readSettings,
  writeSettings,
} from "../settings";
import { registerPermissionTool } from "../permissions";
import { commandExists, runCommand } from "../shell";
import {
  CODE_REVIEW_GRAPH_PACKAGE,
  CODE_REVIEW_GRAPH_PERMISSION_TOOL,
  CODE_REVIEW_GRAPH_SETTINGS_KEY,
  INSTALLER_INSTRUCTION_DEPS,
  INSTALLER_INSTRUCTION_PIP,
  INSTALLER_INSTRUCTION_UV,
} from "../constants";
import { detectInstalledMcpServers, isMcpInstalled } from "../detect";

export interface InstallCodeReviewGraphOptions {
  settingsFilePath: string;
  force: boolean;
}

export async function installCodeReviewGraphMcp(
  options: InstallCodeReviewGraphOptions,
): Promise<boolean> {
  const settingsKey = CODE_REVIEW_GRAPH_SETTINGS_KEY;
  const packageName = CODE_REVIEW_GRAPH_PACKAGE;
  const force = options.force;

  const detected = detectInstalledMcpServers(options.settingsFilePath);
  if (isMcpInstalled(detected, settingsKey)) {
    if (force) {
      console.error(
        `INSTALLER_FORCE_REINSTALL_LOCKED=1 — переустанавливаю ${settingsKey}.`,
      );
    } else {
      console.log(
        `MCP-сервер ${settingsKey} уже зарегистрирован (найден в mcpServers) — пропускаю.`,
      );
      console.log(
        " Для принудительной переустановки задайте INSTALLER_FORCE_REINSTALL_LOCKED=1.",
      );
      return true;
    }
  }

  if (!commandExists("uv")) {
    console.log("Не найден uv — code-review-graph не установлен.");
    console.log(`Инструкция по установке uv: ${INSTALLER_INSTRUCTION_UV}`);
    return true;
  }
  if (!commandExists("pip")) {
    console.log("Не найден pip — code-review-graph не установлен.");
    console.log(`Инструкция по установке pip/python: ${INSTALLER_INSTRUCTION_PIP}`);
    return true;
  }
  if (!commandExists("python")) {
    console.log("Не найден python — code-review-graph не установлен.");
    console.log(`Инструкция по установке pip/python: ${INSTALLER_INSTRUCTION_PIP}`);
    return true;
  }

  console.log(`Устанавливаю ${packageName} через uv pip install ...`);
  const install = runCommand("uv", ["pip", "install", packageName], { stdio: "inherit" });
  if (install.status !== 0) {
    console.log(`Не удалось установить ${packageName} — возможно, нет доступа до зависимостей.`);
    console.log(`Инструкция по настройке окружения: ${INSTALLER_INSTRUCTION_DEPS}`);
    return true;
  }

  const settings = readSettings(options.settingsFilePath);
  await ensureMcpServersSection(options.settingsFilePath, settings);
  (settings.mcpServers as Record<string, unknown>)[settingsKey] = {
    command: "uv",
    args: ["run", "--with", packageName, packageName],
  };
  await writeSettings(options.settingsFilePath, settings);

  if (CODE_REVIEW_GRAPH_PERMISSION_TOOL) {
    await registerPermissionTool(options.settingsFilePath, CODE_REVIEW_GRAPH_PERMISSION_TOOL);
  }
  console.log("MCP-сервер code-review-graph установлен.");
  return true;
}