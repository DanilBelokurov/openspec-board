"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installJiraMcp = installJiraMcp;
const settings_1 = require("../settings");
const permissions_1 = require("../permissions");
const prompts_1 = require("../prompts");
const shell_1 = require("../shell");
const constants_1 = require("../constants");
async function installJiraMcp(options) {
    let token = options.token;
    if (!token) {
        token = await (0, prompts_1.promptForToken)("Токен Jira (x-jira-token).", constants_1.INSTALLER_INSTRUCTION_JIRA_TOKEN);
    }
    if (!(0, shell_1.commandExists)("node")) {
        console.error("Для обновления .gigacode/settings.json требуется Node.js.");
        return false;
    }
    const settings = (0, settings_1.readSettings)(options.settingsFilePath);
    await (0, settings_1.ensureMcpServersSection)(options.settingsFilePath, settings);
    settings.mcpServers["jira-mcp"] = {
        type: "streamable-http",
        httpUrl: "https://api.sbertrack.sberbank.ru/jira/mcp",
        headers: {
            "x-jira-token": token,
        },
    };
    await (0, settings_1.writeSettings)(options.settingsFilePath, settings);
    token = "";
    console.log(`MCP-сервер jira-mcp добавлен в ${options.settingsFilePath}.`);
    await (0, permissions_1.registerPermissionTool)(options.settingsFilePath, "mcp__jira-mcp__add_labels");
    return true;
}
