"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRawLabels = parseRawLabels;
exports.selectArrowOption = selectArrowOption;
exports.selectCheckboxes = selectCheckboxes;
exports.promptForToken = promptForToken;
const node_readline_1 = __importDefault(require("node:readline"));
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_TO_END = "\x1b[J";
const CURSOR_UP = (n) => `\x1b[${n}A`;
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const FG = {
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
};
const isTty = () => Boolean(process.stderr.isTTY);
function style(code, text) {
    return isTty() ? `${code}${text}${RESET}` : text;
}
const RULE_WIDTH = 64;
const HEAVY_RULE_CHAR = "═";
function heavyRule() {
    return style(FG.cyan, HEAVY_RULE_CHAR.repeat(RULE_WIDTH));
}
function lightRule(width = RULE_WIDTH) {
    return style(FG.gray, "─".repeat(width));
}
function parseRawLabels(rawLabels) {
    return rawLabels.map((raw) => {
        const colonIndex = raw.indexOf(":");
        if (colonIndex === -1) {
            return { display: raw, value: raw };
        }
        const display = raw.slice(0, colonIndex);
        const value = raw.slice(colonIndex + 1);
        return { display, value };
    });
}
function setupStdin() {
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }
    node_readline_1.default.emitKeypressEvents(process.stdin);
    process.stderr.write(HIDE_CURSOR);
    return () => {
        process.stdin.removeAllListeners("keypress");
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(Boolean(wasRaw));
        }
        process.stderr.write(SHOW_CURSOR);
    };
}
async function selectArrowOption(prompt, defaultIndex, options) {
    if (options.length === 0) {
        throw new Error("selectArrowOption: пустой список опций.");
    }
    let selected = Math.max(0, Math.min(defaultIndex, options.length - 1));
    // Row budget:
    //   HEADER_ROWS  = 4  (heavy rule, title, hint, light rule)
    //   options      = N
    //   FOOTER_ROWS  = 3  (blank line, summary line, closing rule)
    // TOTAL_ROWS must match the number of lines render() actually writes,
    // otherwise CURSOR_UP lands one row short and a duplicate line of
    // rules accumulates on every keypress.
    const HEADER_ROWS = 4;
    const FOOTER_ROWS = 3;
    const TOTAL_ROWS = HEADER_ROWS + options.length + FOOTER_ROWS;
    const render = () => {
        process.stderr.write(`${heavyRule()}\n`);
        process.stderr.write(`  ${style(BOLD + FG.cyan, prompt)}\n`);
        process.stderr.write(`  ${style(FG.gray, "↑↓ — навигация  ·  Enter — подтвердить")}\n`);
        process.stderr.write(`${lightRule()}\n`);
        for (let i = 0; i < options.length; i++) {
            const isCurrent = i === selected;
            const arrow = isCurrent ? style(BOLD, "❯") : " ";
            const label = isCurrent ? style(BOLD, options[i].label) : options[i].label;
            process.stderr.write(`  ${arrow}  ${label}\n`);
        }
        process.stderr.write("\n");
        process.stderr.write(`  ${style(FG.gray, `выбрано: 1 из ${options.length}`)}\n`);
        process.stderr.write(`${lightRule()}\n`);
    };
    const rerender = () => {
        process.stderr.write(CURSOR_UP(TOTAL_ROWS));
        process.stderr.write(CLEAR_TO_END);
        render();
    };
    render();
    return new Promise((resolve, reject) => {
        const cleanup = setupStdin();
        const onKey = (_str, key) => {
            if (!key)
                return;
            if (key.ctrl && key.name === "c") {
                cleanup();
                process.stderr.write("\n");
                reject(new Error("Отменено пользователем (Ctrl+C)."));
                return;
            }
            if (key.name === "up") {
                selected = (selected + options.length - 1) % options.length;
            }
            else if (key.name === "down") {
                selected = (selected + 1) % options.length;
            }
            else if (key.name === "return" || key.name === "enter" || key.name === "linefeed") {
                cleanup();
                process.stderr.write("\n");
                resolve(options[selected].value);
                return;
            }
            else {
                return;
            }
            rerender();
        };
        process.stdin.on("keypress", onKey);
    });
}
async function selectCheckboxes(prompt, options) {
    if (options.length === 0) {
        return [];
    }
    const selected = options.map((option) => (option.locked ? 1 : 0));
    let cursor = 0;
    const HEADER_ROWS = 4;
    const FOOTER_ROWS = 2;
    const ITEM_ROWS = options.length + 1; // +1 for blank line before footer
    const TOTAL_ROWS = HEADER_ROWS + ITEM_ROWS + FOOTER_ROWS;
    const lockedCount = options.filter((o) => o.locked).length;
    const availableCount = options.length - lockedCount;
    const render = () => {
        process.stderr.write(`${heavyRule()}\n`);
        process.stderr.write(`  ${style(BOLD + FG.cyan, prompt)}\n`);
        process.stderr.write(`  ${style(FG.gray, "Space — отметить  ·  ↑↓ — навигация  ·  Enter — подтвердить")}\n`);
        process.stderr.write(`${lightRule()}\n`);
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const isCurrent = i === cursor;
            const arrow = isCurrent ? style(BOLD, "❯") : " ";
            let marker;
            if (opt.locked) {
                marker = style(FG.gray, "[●]");
            }
            else if (selected[i]) {
                marker = style(FG.green, "[x]");
            }
            else {
                marker = "[ ]";
            }
            const labelText = isCurrent ? style(BOLD, opt.label) : opt.label;
            const hint = opt.hint ? `  ${style(FG.gray, "— " + opt.hint)}` : "";
            process.stderr.write(`  ${arrow}  ${marker} ${labelText}${hint}\n`);
        }
        process.stderr.write("\n");
        const willInstall = selected.filter(Boolean).length - lockedCount;
        const summary = lockedCount > 0
            ? `выбрано: ${selected.filter(Boolean).length} из ${options.length}  ·  к установке: ${willInstall} новых`
            : `выбрано: ${selected.filter(Boolean).length} из ${options.length}`;
        process.stderr.write(`  ${style(FG.gray, summary)}\n`);
        process.stderr.write(`${lightRule()}\n`);
    };
    const rerender = () => {
        process.stderr.write(CURSOR_UP(TOTAL_ROWS));
        process.stderr.write(CLEAR_TO_END);
        render();
    };
    render();
    void availableCount;
    return new Promise((resolve, reject) => {
        const cleanup = setupStdin();
        const onKey = (_str, key) => {
            if (!key)
                return;
            if (key.ctrl && key.name === "c") {
                cleanup();
                process.stderr.write("\n");
                reject(new Error("Отменено пользователем (Ctrl+C)."));
                return;
            }
            if (key.name === "up") {
                cursor = (cursor + options.length - 1) % options.length;
            }
            else if (key.name === "down") {
                cursor = (cursor + 1) % options.length;
            }
            else if (key.name === "space") {
                if (options[cursor].locked) {
                    rerender();
                    return;
                }
                selected[cursor] = selected[cursor] ? 0 : 1;
            }
            else if (key.name === "return" || key.name === "enter" || key.name === "linefeed") {
                cleanup();
                process.stderr.write("\n");
                const result = [];
                for (let i = 0; i < options.length; i++) {
                    if (selected[i])
                        result.push(options[i].value);
                }
                resolve(result);
                return;
            }
            else {
                return;
            }
            rerender();
        };
        process.stdin.on("keypress", onKey);
    });
}
async function promptForToken(label, instructionUrl) {
    process.stderr.write(`${heavyRule()}\n`);
    process.stderr.write(`  ${style(BOLD + FG.cyan, label)}\n`);
    if (instructionUrl) {
        process.stderr.write(`  ${style(FG.gray, "Где взять токен: " + instructionUrl)}\n`);
    }
    process.stderr.write(`${lightRule(40)}\n`);
    process.stderr.write("  Введите токен: ");
    return new Promise((resolve, reject) => {
        const rl = node_readline_1.default.createInterface({
            input: process.stdin,
            output: process.stderr,
            terminal: false,
        });
        rl.once("line", (line) => {
            rl.close();
            const value = line.replace(/\r$/, "");
            process.stderr.write("\n");
            process.stderr.write(`${lightRule(40)}\n`);
            if (!value) {
                reject(new Error("Токен не может быть пустым."));
                return;
            }
            resolve(value);
        });
    });
}
