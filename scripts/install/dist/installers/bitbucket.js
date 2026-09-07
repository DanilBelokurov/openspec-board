"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.installBitbucketMcp = installBitbucketMcp;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const settings_1 = require("../settings");
const permissions_1 = require("../permissions");
const prompts_1 = require("../prompts");
const shell_1 = require("../shell");
const git_1 = require("../git");
const constants_1 = require("../constants");
async function installBitbucketMcp(options) {
    let token = options.token;
    if (!token) {
        token = await (0, prompts_1.promptForToken)("Токен bitbucket (BITBUCKET_TOKEN).", constants_1.INSTALLER_INSTRUCTION_BITBUCKET_TOKEN);
    }
    if (!(0, shell_1.commandExists)("git")) {
        console.error("Для клонирования MCP bitbucket требуется git.");
        return false;
    }
    if (!(0, shell_1.commandExists)("npm")) {
        console.error("Для сборки MCP bitbucket требуется npm.");
        return false;
    }
    if (!(0, shell_1.commandExists)("node")) {
        console.error("Для обновления .gigacode/settings.json требуется Node.js.");
        return false;
    }
    const repoUrl = constants_1.MCP_BITBUCKET_REPO_URL;
    const localDir = constants_1.MCP_BITBUCKET_LOCAL_DIR;
    const buildSubdir = constants_1.MCP_BITBUCKET_SUBDIR === "." ? "" : constants_1.MCP_BITBUCKET_SUBDIR;
    const buildDir = buildSubdir ? node_path_1.default.join(localDir, buildSubdir) : localDir;
    const entryRel = buildSubdir
        ? node_path_1.default.join(buildSubdir, constants_1.MCP_BITBUCKET_ENTRY)
        : constants_1.MCP_BITBUCKET_ENTRY;
    const entryPath = node_path_1.default.join(localDir, entryRel);
    if (repoUrl.startsWith("placeholder/")) {
        console.error("MCP_BITBUCKET_REPO_URL не настроен (значение placeholder). Укажите реальный URL в переменной окружения или в шапке скрипта и повторите установку.");
        return false;
    }
    if (!(0, git_1.cloneRepo)(repoUrl, localDir, "bitbucket"))
        return false;
    if (!(0, git_1.buildNpmProject)(buildDir, "bitbucket"))
        return false;
    if (!(0, node_fs_1.existsSync)(entryPath)) {
        console.error(`После сборки не найден ${entryPath} — установка остановлена.`);
        return false;
    }
    const settings = (0, settings_1.readSettings)(options.settingsFilePath);
    await (0, settings_1.ensureMcpServersSection)(options.settingsFilePath, settings);
    settings.mcpServers.bitbucket = {
        command: "node",
        args: [entryPath],
        env: {
            BITBUCKET_URL: constants_1.MCP_BITBUCKET_API_URL,
            BITBUCKET_TOKEN: token,
        },
    };
    await (0, settings_1.writeSettings)(options.settingsFilePath, settings);
    token = "";
    console.log(`MCP-сервер bitbucket добавлен в ${options.settingsFilePath}.`);
    await (0, permissions_1.registerPermissionTool)(options.settingsFilePath, constants_1.MCP_BITBUCKET_PERMISSION_TOOL);
    return true;
}
