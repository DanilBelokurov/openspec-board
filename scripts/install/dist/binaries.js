"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PIP_CANDIDATES = exports.PYTHON_CANDIDATES = void 0;
exports.resolveFromCandidates = resolveFromCandidates;
exports.resolvePython = resolvePython;
exports.resolvePip = resolvePip;
const shell_1 = require("./shell");
function resolveFromCandidates(candidates, args = ["--version"]) {
    for (const bin of candidates) {
        if (!(0, shell_1.commandExists)(bin))
            continue;
        const result = (0, shell_1.runCommand)(bin, args, { stdio: "pipe" });
        if (result.status !== 0)
            continue;
        const stream = (result.stdout || result.stderr || "").trim();
        const firstLine = stream.split("\n", 1)[0]?.trim() ?? "";
        if (firstLine) {
            return { present: true, binary: bin, version: firstLine };
        }
    }
    return { present: false };
}
exports.PYTHON_CANDIDATES = [
    "python3.13",
    "python3.12",
    "python3.11",
    "python3.10",
    "python3.9",
    "python3.8",
    "python3.7",
    "python3",
    "python",
];
exports.PIP_CANDIDATES = [
    "pip3.13",
    "pip3.12",
    "pip3.11",
    "pip3.10",
    "pip3.9",
    "pip3.8",
    "pip3.7",
    "pip3",
    "pip",
];
function resolvePython() {
    return resolveFromCandidates(exports.PYTHON_CANDIDATES);
}
function resolvePip() {
    return resolveFromCandidates(exports.PIP_CANDIDATES);
}
