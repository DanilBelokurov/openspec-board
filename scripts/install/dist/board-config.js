"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOARD_CONFIG_PATH = void 0;
exports.resolveBoardConfigPath = resolveBoardConfigPath;
exports.updateBoardConfig = updateBoardConfig;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const atomic_write_1 = require("./atomic-write");
const print_1 = require("./print");
exports.BOARD_CONFIG_PATH = node_path_1.default.join(".sdd-board", "config.json");
function resolveBoardConfigPath(boardRoot) {
    return node_path_1.default.join(boardRoot, exports.BOARD_CONFIG_PATH);
}
function updateBoardConfig(boardRoot, updates) {
    const configPath = resolveBoardConfigPath(boardRoot);
    if (!(0, node_fs_1.existsSync)(configPath)) {
        print_1.print.warn(`config.json не найден: ${configPath}`);
        return {
            path: configPath,
            found: false,
            changed: false,
            previous: {},
            current: {},
        };
    }
    let current;
    try {
        current = JSON.parse((0, node_fs_1.readFileSync)(configPath, "utf8"));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        print_1.print.error(`Невалидный JSON в ${configPath}: ${message}`);
        return {
            path: configPath,
            found: true,
            changed: false,
            previous: {},
            current: {},
        };
    }
    const previous = { ...current };
    let changed = false;
    for (const [key, value] of Object.entries(updates)) {
        if (value === undefined)
            continue;
        if (current[key] === value)
            continue;
        current[key] = value;
        changed = true;
    }
    if (!changed) {
        print_1.print.dim(`config.json уже содержит нужные значения — пропускаю.`);
        return { path: configPath, found: true, changed: false, previous, current };
    }
    (0, atomic_write_1.atomicWriteJson)(configPath, current);
    const changedKeys = Object.keys(updates).filter((k) => updates[k] !== undefined && previous[k] !== current[k]);
    print_1.print.success(`config.json обновлён: ${changedKeys.join(", ")}`);
    return { path: configPath, found: true, changed: true, previous, current };
}
