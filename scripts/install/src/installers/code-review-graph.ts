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

export const PYTHON_CANDIDATES = [
  "python3.13",
  "python3.12",
  "python3.11",
  "python3.10",
  "python3.9",
  "python3.8",
  "python3.7",
  "python3",
  "python",
];

export interface PythonResolution {
  present: boolean;
  binary?: string;
  version?: string;
}

export function resolvePython(): PythonResolution {
  for (const bin of PYTHON_CANDIDATES) {
    if (!commandExists(bin)) continue;
    const result = runCommand(bin, ["--version"], { stdio: "pipe" });
    if (result.status !== 0) continue;
    const stream = (result.stdout || result.stderr || "").trim();
    const firstLine = stream.split("\n", 1)[0]?.trim() ?? "";
    if (firstLine) {
      return { present: true, binary: bin, version: firstLine };
    }
  }
  return { present: false };
}

export async function installCodeReviewGraphMcp(
  options: InstallCodeReviewGraphOptions,
): Promise<boolean> {
  print.step("Разрешение Python для code-review-graph ...");
  const python = resolvePython();
  if (python.present) {
    print.success(`python (через ${python.binary}) — ${python.version}`);
  } else {
    print.warn(
      "Системный python не найден (проверены python3.7..3.13 и python). " +
        "uv поставляет собственный Python, поэтому установка продолжится.",
    );
    print.note(`Если нужен fallback через pip: ${INSTALLER_INSTRUCTION_PIP}`);
  }

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
  if (!python.present) {
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