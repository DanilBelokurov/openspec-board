"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectInstalledMcpServers = detectInstalledMcpServers;
exports.isMcpInstalled = isMcpInstalled;
const settings_1 = require("./settings");
function detectInstalledMcpServers(settingsFilePath) {
    let settings;
    try {
        settings = (0, settings_1.readSettings)(settingsFilePath);
    }
    catch (_error) {
        return [];
    }
    const servers = settings.mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
        return [];
    }
    return Object.keys(servers);
}
function isMcpInstalled(detectedKeys, targetKey) {
    return detectedKeys.includes(targetKey);
}
