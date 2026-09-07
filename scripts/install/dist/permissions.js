"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureMcpServersSection = void 0;
exports.registerPermissionTool = registerPermissionTool;
exports.reconcileMcpServerKeys = reconcileMcpServerKeys;
exports.syncRequiredPermissions = syncRequiredPermissions;
const settings_1 = require("./settings");
Object.defineProperty(exports, "ensureMcpServersSection", { enumerable: true, get: function () { return settings_1.ensureMcpServersSection; } });
const catalog_1 = require("./catalog");
const print_1 = require("./print");
async function registerPermissionTool(settingsFilePath, tool) {
    const settings = (0, settings_1.readSettings)(settingsFilePath);
    await (0, settings_1.ensurePermissionsSection)(settings);
    const allow = settings.permissions.allow;
    if (!allow.includes(tool)) {
        allow.push(tool);
    }
    await (0, settings_1.writeSettings)(settingsFilePath, settings);
    print_1.print.success(`Разрешение ${tool} добавлено в permissions.allow.`);
}
async function reconcileMcpServerKeys(settingsFilePath) {
    const result = {
        changed: false,
        rewrites: [],
        removedDuplicates: [],
    };
    let settings;
    try {
        settings = (0, settings_1.readSettings)(settingsFilePath);
    }
    catch (_error) {
        return result;
    }
    const servers = settings.mcpServers;
    if (!servers) {
        return result;
    }
    for (const plan of catalog_1.MCP_CATALOG_ENTRIES) {
        if (!plan.matcher)
            continue;
        const foreignKeys = Object.keys(servers).filter((key) => key !== plan.settingsKey && plan.matcher(servers[key]));
        if (foreignKeys.length === 0)
            continue;
        if (Object.prototype.hasOwnProperty.call(servers, plan.settingsKey)) {
            for (const key of foreignKeys) {
                delete servers[key];
                result.removedDuplicates.push(key);
                result.changed = true;
                print_1.print.dim(`[reconcile] удалён дубль mcpServers["${key}"]`);
            }
            continue;
        }
        const [promotedKey, ...staleKeys] = foreignKeys;
        servers[plan.settingsKey] = servers[promotedKey];
        for (const key of staleKeys) {
            delete servers[key];
            result.removedDuplicates.push(key);
            result.changed = true;
        }
        delete servers[promotedKey];
        result.changed = true;
        result.rewrites.push({ from: promotedKey, to: plan.settingsKey });
        print_1.print.dim(`[reconcile] mcpServers["${promotedKey}"] → mcpServers["${plan.settingsKey}"]`);
    }
    if (result.changed) {
        await (0, settings_1.writeSettings)(settingsFilePath, settings);
    }
    return result;
}
async function syncRequiredPermissions(settingsFilePath) {
    const result = { changed: false, added: [] };
    let settings;
    try {
        settings = (0, settings_1.readSettings)(settingsFilePath);
    }
    catch (_error) {
        return result;
    }
    const servers = settings.mcpServers;
    if (!servers)
        return result;
    const desired = [];
    for (const row of catalog_1.MCP_CATALOG_ENTRIES) {
        if (!Object.prototype.hasOwnProperty.call(servers, row.settingsKey))
            continue;
        for (const tool of row.permissions)
            desired.push(tool);
    }
    if (desired.length === 0)
        return result;
    await (0, settings_1.ensurePermissionsSection)(settings);
    const allow = settings.permissions.allow;
    const present = new Set(allow);
    for (const tool of desired) {
        if (present.has(tool))
            continue;
        allow.push(tool);
        present.add(tool);
        result.added.push(tool);
    }
    if (result.added.length > 0) {
        await (0, settings_1.writeSettings)(settingsFilePath, settings);
        result.changed = true;
        print_1.print.dim(`[permissions] добавлены: ${result.added.join(", ")}`);
    }
    return result;
}
