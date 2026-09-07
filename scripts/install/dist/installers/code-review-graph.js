"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installCodeReviewGraphMcp = installCodeReviewGraphMcp;
const settings_1 = require("../settings");
const permissions_1 = require("../permissions");
const shell_1 = require("../shell");
const binaries_1 = require("../binaries");
const constants_1 = require("../constants");
const detect_1 = require("../detect");
const print_1 = require("../print");
async function installCodeReviewGraphMcp(options) {
    print_1.print.step("Разрешение Python для code-review-graph ...");
    const python = (0, binaries_1.resolvePython)();
    if (python.present) {
        print_1.print.success(`python (через ${python.binary}) — ${python.version}`);
    }
    else {
        print_1.print.warn("Системный python не найден (проверены python3.7..3.13 и python). " +
            "uv поставляет собственный Python, поэтому установка продолжится.");
        print_1.print.note(`Если нужен fallback через pip: ${constants_1.INSTALLER_INSTRUCTION_PIP}`);
    }
    print_1.print.step("Разрешение pip для code-review-graph ...");
    const pip = (0, binaries_1.resolvePip)();
    if (pip.present) {
        print_1.print.success(`pip (через ${pip.binary}) — ${pip.version}`);
    }
    else {
        print_1.print.warn("Системный pip не найден (проверены pip3.7..3.13, pip3, pip). " +
            "uv поставляет собственный pip через uv pip install, поэтому установка продолжится.");
        print_1.print.note(`Инструкция по установке pip: ${constants_1.INSTALLER_INSTRUCTION_PIP}`);
    }
    const settingsKey = constants_1.CODE_REVIEW_GRAPH_SETTINGS_KEY;
    const packageName = constants_1.CODE_REVIEW_GRAPH_PACKAGE;
    const force = options.force;
    const detected = (0, detect_1.detectInstalledMcpServers)(options.settingsFilePath);
    if ((0, detect_1.isMcpInstalled)(detected, settingsKey)) {
        if (force) {
            print_1.print.warn(`Принудительная переустановка ${settingsKey}.`);
        }
        else {
            print_1.print.dim(`MCP-сервер ${settingsKey} уже зарегистрирован (найден в mcpServers) — пропускаю.`);
            print_1.print.dim("Для принудительной переустановки задайте INSTALLER_FORCE_REINSTALL_LOCKED=1 или --force.");
            return true;
        }
    }
    if (!(0, shell_1.commandExists)("uv")) {
        print_1.print.warn("Не найден uv — code-review-graph не установлен.");
        print_1.print.note(`Инструкция по установке uv: ${constants_1.INSTALLER_INSTRUCTION_UV}`);
        return true;
    }
    if (!pip.present) {
        print_1.print.warn("Не найден pip — code-review-graph не установлен через fallback pip.");
        print_1.print.note(`Инструкция по установке pip/python: ${constants_1.INSTALLER_INSTRUCTION_PIP}`);
        return true;
    }
    if (!python.present) {
        print_1.print.warn("Не найден python — code-review-graph не установлен через fallback pip.");
        print_1.print.note(`Инструкция по установке pip/python: ${constants_1.INSTALLER_INSTRUCTION_PIP}`);
        return true;
    }
    print_1.print.step(`Устанавливаю ${packageName} через uv pip install ...`);
    const install = (0, shell_1.runCommand)("uv", ["pip", "install", packageName], { stdio: "inherit" });
    if (install.status !== 0) {
        print_1.print.warn(`Не удалось установить ${packageName} — возможно, нет доступа до зависимостей.`);
        print_1.print.note(`Инструкция по настройке окружения: ${constants_1.INSTALLER_INSTRUCTION_DEPS}`);
        return true;
    }
    const settings = (0, settings_1.readSettings)(options.settingsFilePath);
    await (0, settings_1.ensureMcpServersSection)(options.settingsFilePath, settings);
    settings.mcpServers[settingsKey] = {
        command: "uv",
        args: ["run", "--with", packageName, packageName],
    };
    await (0, settings_1.writeSettings)(options.settingsFilePath, settings);
    if (constants_1.CODE_REVIEW_GRAPH_PERMISSION_TOOL) {
        await (0, permissions_1.registerPermissionTool)(options.settingsFilePath, constants_1.CODE_REVIEW_GRAPH_PERMISSION_TOOL);
    }
    print_1.print.success("MCP-сервер code-review-graph установлен.");
    return true;
}
