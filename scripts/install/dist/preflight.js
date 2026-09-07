"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeEnvironment = probeEnvironment;
exports.evaluatePreflight = evaluatePreflight;
exports.runPreflight = runPreflight;
const shell_1 = require("./shell");
const constants_1 = require("./constants");
const print_1 = require("./print");
function probe(bin, args = ["--version"]) {
    if (!(0, shell_1.commandExists)(bin)) {
        return { present: false };
    }
    const result = (0, shell_1.runCommand)(bin, args, { stdio: "pipe" });
    if (result.status !== 0) {
        return { present: true };
    }
    const stream = (result.stdout || result.stderr || "").trim();
    const firstLine = stream.split("\n", 1)[0]?.trim() ?? "";
    return { present: true, version: firstLine || undefined };
}
async function probeEnvironment() {
    return {
        node: probe("node"),
        python: probe("python"),
        uv: probe("uv"),
        gigacode: probe("gigacode"),
    };
}
function evaluatePreflight(input) {
    const checks = [
        {
            id: "node",
            label: "node",
            required: true,
            present: input.node.present,
            version: input.node.version,
            consequence: "Требуется для запуска самого инсталлятора и записи settings.json.",
        },
        {
            id: "python",
            label: "python",
            required: false,
            present: input.python.present,
            version: input.python.version,
            consequence: "Нужен для MCP-сервера code-review-graph (устанавливается в режиме «Аналитик/разработчик»).",
            instructions: constants_1.INSTALLER_INSTRUCTION_PIP,
        },
        {
            id: "uv",
            label: "uv",
            required: false,
            present: input.uv.present,
            version: input.uv.version,
            consequence: "Нужен для установки MCP-сервера code-review-graph через uv pip install.",
            instructions: constants_1.INSTALLER_INSTRUCTION_UV,
        },
        {
            id: "gigacode",
            label: "gigacode",
            required: false,
            present: input.gigacode.present,
            version: input.gigacode.version,
            consequence: "Используется самой доской (gigacode --prompt per-step).",
        },
    ];
    const requiredMissing = checks
        .filter((c) => c.required && !c.present)
        .map((c) => c.id);
    const optionalMissing = checks
        .filter((c) => !c.required && !c.present)
        .map((c) => c.id);
    return {
        ok: requiredMissing.length === 0,
        requiredMissing,
        optionalMissing,
        checks,
    };
}
async function runPreflight() {
    const input = await probeEnvironment();
    const result = evaluatePreflight(input);
    print_1.print.section("Проверка окружения");
    for (const check of result.checks) {
        const version = check.version ? ` ${check.version}` : "";
        if (check.present) {
            print_1.print.success(`${check.label}${version}`);
            continue;
        }
        if (check.required) {
            print_1.print.error(`${check.label} — не найден (обязательно)`);
        }
        else {
            print_1.print.warn(`${check.label} — не найден`);
        }
        if (check.consequence)
            print_1.print.note(check.consequence);
        if (check.instructions)
            print_1.print.note(check.instructions);
    }
    print_1.print.blank();
    if (result.ok) {
        if (result.optionalMissing.length === 0) {
            print_1.print.info("Все инструменты найдены.");
        }
        else {
            print_1.print.info(`Найдены все обязательные инструменты. Опциональные отсутствуют: ${result.optionalMissing.join(", ")}.`);
        }
    }
    else {
        print_1.print.error(`Не найдены обязательные инструменты: ${result.requiredMissing.join(", ")}.`);
        print_1.print.warn("Установите их и запустите инсталлятор повторно. Выход без изменений.");
    }
    print_1.print.blank();
    return result;
}
