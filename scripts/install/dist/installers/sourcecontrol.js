"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.installSourcecontrolMcp = installSourcecontrolMcp;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const settings_1 = require("../settings");
const permissions_1 = require("../permissions");
const prompts_1 = require("../prompts");
const shell_1 = require("../shell");
const git_1 = require("../git");
const constants_1 = require("../constants");
const print_1 = require("../print");
async function installSourcecontrolMcp(options) {
    let token = options.token;
    if (!token) {
        token = await (0, prompts_1.promptForToken)("Токен sourcecontrol (SC_TOKEN).", constants_1.INSTALLER_INSTRUCTION_SOURCECONTROL_TOKEN);
    }
    if (!(0, shell_1.commandExists)("git")) {
        print_1.print.error("Для клонирования MCP sourcecontrol требуется git.");
        return false;
    }
    if (!(0, shell_1.commandExists)("npm")) {
        print_1.print.error("Для сборки MCP sourcecontrol требуется npm.");
        return false;
    }
    if (!(0, shell_1.commandExists)("node")) {
        print_1.print.error("Для обновления .gigacode/settings.json требуется Node.js.");
        return false;
    }
    const localDir = constants_1.MCP_SOURCECONTROL_LOCAL_DIR;
    const repoUrl = constants_1.MCP_SOURCECONTROL_REPO_URL;
    const entry = constants_1.MCP_SOURCECONTROL_ENTRY;
    if (!(0, git_1.cloneRepo)(repoUrl, localDir, "sourcecontrol"))
        return false;
    if (!(0, git_1.buildNpmProject)(localDir, "sourcecontrol"))
        return false;
    const entryPath = node_path_1.default.join(localDir, entry);
    if (!(0, node_fs_1.existsSync)(entryPath)) {
        print_1.print.error(`После сборки не найден ${entryPath} — установка остановлена.`);
        return false;
    }
    const settings = (0, settings_1.readSettings)(options.settingsFilePath);
    await (0, settings_1.ensureMcpServersSection)(options.settingsFilePath, settings);
    settings.mcpServers.sourcecontrol = {
        command: "node",
        args: [entryPath],
        env: {
            SC_API_URL: constants_1.MCP_SOURCECONTROL_API_URL,
            SC_TOKEN: token,
        },
    };
    await (0, settings_1.writeSettings)(options.settingsFilePath, settings);
    token = "";
    print_1.print.success(`MCP-сервер sourcecontrol добавлен в ${options.settingsFilePath}.`);
    await (0, permissions_1.registerPermissionTool)(options.settingsFilePath, "mcp__sourcecontrol__git_create_pull_request");
    return true;
}
