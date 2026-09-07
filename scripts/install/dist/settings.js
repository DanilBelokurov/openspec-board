"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettingsDir = getSettingsDir;
exports.getSettingsPath = getSettingsPath;
exports.settingsPathOverride = settingsPathOverride;
exports.readSettings = readSettings;
exports.ensureObject = ensureObject;
exports.writeSettings = writeSettings;
exports.ensureMcpServersSection = ensureMcpServersSection;
exports.ensurePermissionsSection = ensurePermissionsSection;
exports.settingsFileExists = settingsFileExists;
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const atomic_write_1 = require("./atomic-write");
function getSettingsDir() {
    return node_path_1.default.join(node_os_1.default.homedir(), ".gigacode");
}
function getSettingsPath() {
    return node_path_1.default.join(getSettingsDir(), "settings.json");
}
function settingsPathOverride(filePath) {
    return filePath ?? getSettingsPath();
}
function readSettings(filePath) {
    if (!(0, node_fs_1.existsSync)(filePath)) {
        return {};
    }
    const raw = (0, node_fs_1.readFileSync)(filePath, "utf8").trim();
    if (raw.length === 0) {
        return {};
    }
    const parsed = JSON.parse(raw);
    ensureObject(parsed, `Файл ${filePath} должен содержать JSON-объект.`);
    return parsed;
}
function ensureObject(value, message) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(message);
    }
}
async function writeSettings(filePath, settings) {
    (0, node_fs_1.mkdirSync)(node_path_1.default.dirname(filePath), { recursive: true });
    await (0, atomic_write_1.atomicWriteJson)(filePath, settings);
}
async function ensureMcpServersSection(filePath, settings) {
    if (settings.mcpServers === undefined) {
        settings.mcpServers = {};
    }
    ensureObject(settings.mcpServers, `Поле mcpServers в ${filePath} должно быть JSON-объектом.`);
    return settings;
}
async function ensurePermissionsSection(settings) {
    if (settings.permissions === undefined) {
        settings.permissions = {};
    }
    ensureObject(settings.permissions, "Поле permissions в settings.json должно быть JSON-объектом.");
    if (!Array.isArray(settings.permissions.allow)) {
        settings.permissions.allow = [];
    }
    const allow = settings.permissions.allow;
    if (!allow.every((value) => typeof value === "string")) {
        throw new Error("Поле permissions.allow должно содержать только строки.");
    }
    return settings;
}
function settingsFileExists(filePath) {
    return (0, node_fs_1.existsSync)(filePath);
}
