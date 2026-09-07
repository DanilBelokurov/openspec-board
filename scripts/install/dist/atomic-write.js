"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.atomicWriteJson = atomicWriteJson;
const node_fs_1 = require("node:fs");
const node_fs_2 = require("node:fs");
const DEFAULT_MODE = 0o600;
async function atomicWriteJson(filePath, data, options = {}) {
    const { mode = DEFAULT_MODE, trailingNewline = true } = options;
    const payload = JSON.stringify(data, null, 2) + (trailingNewline ? "\n" : "");
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await node_fs_1.promises.writeFile(tempPath, payload, { encoding: "utf8", mode });
    (0, node_fs_2.chmodSync)(tempPath, mode);
    (0, node_fs_2.renameSync)(tempPath, filePath);
}
