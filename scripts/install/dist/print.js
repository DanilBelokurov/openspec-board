"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.print = void 0;
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const FG = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
};
const isTty = () => Boolean(process.stderr.isTTY);
function style(code, text) {
    return isTty() ? `${code}${text}${RESET}` : text;
}
function rule(width = 60) {
    return isTty() ? style(FG.gray, "─".repeat(width)) : "─".repeat(width);
}
exports.print = {
    banner(title, subtitle) {
        process.stdout.write(`\n${rule()}\n`);
        process.stdout.write(`  ${style(BOLD + FG.cyan, title)}\n`);
        if (subtitle) {
            process.stdout.write(`  ${style(FG.gray, subtitle)}\n`);
        }
        process.stdout.write(`${rule()}\n\n`);
    },
    section(title) {
        process.stdout.write(`\n${style(BOLD, "▶ " + title)}\n`);
    },
    step(message) {
        process.stdout.write(`  ${style(FG.magenta, "→")} ${message}\n`);
    },
    info(message) {
        process.stdout.write(`  ${style(FG.cyan, "ℹ")} ${message}\n`);
    },
    success(message) {
        process.stdout.write(`  ${style(FG.green, "✓")} ${message}\n`);
    },
    warn(message) {
        process.stderr.write(`  ${style(FG.yellow, "⚠")} ${message}\n`);
    },
    error(message) {
        process.stderr.write(`  ${style(FG.red, "✗")} ${message}\n`);
    },
    dim(message) {
        process.stdout.write(`  ${style(FG.gray, message)}\n`);
    },
    note(message) {
        process.stdout.write(`    ${style(FG.gray, message)}\n`);
    },
    blank() {
        process.stdout.write("\n");
    },
    raw(message) {
        process.stdout.write(message);
    },
};
