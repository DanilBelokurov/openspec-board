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
import { print } from "../print";

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
      print.warn(`Принудительная переустановка ${settingsKey}.`);
    } else {
      print.dim(`MCP-сервер ${settingsKey} уже зарегистрирован (найден в mcpServers) — пропускаю.`);
      print.dim("Для принудительной переустановки задайте INSTALLER_FORCE_REINSTALL_LOCKED=1 или --force.");
      return true;
    }
  }

  if (!commandExists("uv")) {
    print.warn("Не найден uv — code-review-graph не установлен.");
    print.note(`Инструкция по установке uv: ${INSTALLER_INSTRUCTION_UV}`);
    return true;
  }
  if (!commandExists("pip")) {
    print.warn("Не найден pip — code-review-graph не установлен.");
    print.note(`Инструкция по установке pip/python: ${INSTALLER_INSTRUCTION_PIP}`);
    return true;
  }
  if (!commandExists("python")) {
    print.warn("Не найден python — code-review-graph не установлен.");
    print.note(`Инструкция по установке pip/python: ${INSTALLER_INSTRUCTION_PIP}`);
    return true;
  }

  print.step(`Устанавливаю ${packageName} через uv pip install ...`);
  const install = runCommand("uv", ["pip", "install", packageName], { stdio: "inherit" });
  if (install.status !== 0) {
    print.warn(`Не удалось установить ${packageName} — возможно, нет доступа до зависимостей.`);
    print.note(`Инструкция по настройке окружения: ${INSTALLER_INSTRUCTION_DEPS}`);
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
  print.success("MCP-сервер code-review-graph установлен.");
  return true;
}