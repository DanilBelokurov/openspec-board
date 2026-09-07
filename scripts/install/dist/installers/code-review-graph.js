"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installCodeReviewGraphMcp = installCodeReviewGraphMcp;
const settings_1 = require("../settings");
const permissions_1 = require("../permissions");
const shell_1 = require("../shell");
const constants_1 = require("../constants");
const detect_1 = require("../detect");
async function installCodeReviewGraphMcp(options) {
    const settingsKey = constants_1.CODE_REVIEW_GRAPH_SETTINGS_KEY;
    const packageName = constants_1.CODE_REVIEW_GRAPH_PACKAGE;
    const force = options.force;
    const detected = (0, detect_1.detectInstalledMcpServers)(options.settingsFilePath);
    if ((0, detect_1.isMcpInstalled)(detected, settingsKey)) {
        if (force) {
            console.error(`INSTALLER_FORCE_REINSTALL_LOCKED=1 — переустанавливаю ${settingsKey}.`);
        }
        else {
            console.log(`MCP-сервер ${settingsKey} уже зарегистрирован (найден в mcpServers) — пропускаю.`);
            console.log(" Для принудительной переустановки задайте INSTALLER_FORCE_REINSTALL_LOCKED=1.");
            return true;
        }
    }
    if (!(0, shell_1.commandExists)("uv")) {
        console.log("Не найден uv — code-review-graph не установлен.");
        console.log(`Инструкция по установке uv: ${constants_1.INSTALLER_INSTRUCTION_UV}`);
        return true;
    }
    if (!(0, shell_1.commandExists)("pip")) {
        console.log("Не найден pip — code-review-graph не установлен.");
        console.log(`Инструкция по установке pip/python: ${constants_1.INSTALLER_INSTRUCTION_PIP}`);
        return true;
    }
    if (!(0, shell_1.commandExists)("python")) {
        console.log("Не найден python — code-review-graph не установлен.");
        console.log(`Инструкция по установке pip/python: ${constants_1.INSTALLER_INSTRUCTION_PIP}`);
        return true;
    }
    console.log(`Устанавливаю ${packageName} через uv pip install ...`);
    const install = (0, shell_1.runCommand)("uv", ["pip", "install", packageName], { stdio: "inherit" });
    if (install.status !== 0) {
        console.log(`Не удалось установить ${packageName} — возможно, нет доступа до зависимостей.`);
        console.log(`Инструкция по настройке окружения: ${constants_1.INSTALLER_INSTRUCTION_DEPS}`);
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
    console.log("MCP-сервер code-review-graph установлен.");
    return true;
}
