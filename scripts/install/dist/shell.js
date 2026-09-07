"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commandExists = commandExists;
exports.runCommand = runCommand;
const node_child_process_1 = require("node:child_process");
function commandExists(bin) {
    const probe = (0, node_child_process_1.spawnSync)("which", [bin], { stdio: "ignore" });
    return probe.status === 0;
}
function runCommand(bin, args, options = {}) {
    const stdio = options.stdio ?? "inherit";
    const proc = (0, node_child_process_1.spawnSync)(bin, args, {
        cwd: options.cwd,
        env: options.env,
        stdio,
        input: options.input,
        encoding: "utf8",
    });
    return {
        status: proc.status,
        stdout: proc.stdout ?? "",
        stderr: proc.stderr ?? "",
        error: proc.error ?? undefined,
    };
}
