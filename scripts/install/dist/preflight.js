"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeEnvironment = probeEnvironment;
exports.evaluatePreflight = evaluatePreflight;
exports.runPreflight = runPreflight;
const shell_1 = require("./shell");
const constants_1 = require("./constants");
const print_1 = require("./print");
const PYTHON_CANDIDATES = [
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
function probe(bin, args = ["--version"]) {
    if (!(0, shell_1.commandExists)(bin)) {
        return { present: false };
    }
    const result = (0, shell_1.runCommand)(bin, args, { stdio: "pipe" });
    if (result.status !== 0) {
        return { present: true, binary: bin };
    }
    const stream = (result.stdout || result.stderr || "").trim();
    const firstLine = stream.split("\n", 1)[0]?.trim() ?? "";
    return {
        present: true,
        version: firstLine || undefined,
        binary: bin,
    };
}
function probeByCandidates(candidates, args = ["--version"]) {
    for (const bin of candidates) {
        if (!(0, shell_1.commandExists)(bin))
            continue;
        const result = (0, shell_1.runCommand)(bin, args, { stdio: "pipe" });
        if (result.status !== 0)
            continue;
        const stream = (result.stdout || result.stderr || "").trim();
        const firstLine = stream.split("\n", 1)[0]?.trim() ?? "";
        if (!firstLine) {
            return { present: true, binary: bin };
        }
        return { present: true, version: firstLine, binary: bin };
    }
    return { present: false };
}
async function probeEnvironment() {
    return {
        node: probe("node"),
        python: probeByCandidates(PYTHON_CANDIDATES),
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
            binary: input.node.binary,
            consequence: "Требуется для запуска самого инсталлятора и записи settings.json.",
        },
        {
            id: "python",
            label: "python",
            required: false,
            present: input.python.present,
            version: input.python.version,
            binary: input.python.binary,
            consequence: "Нужен для MCP-сервера code-review-graph (устанавливается в режиме «Аналитик/разработчик»).",
            instructions: constants_1.INSTALLER_INSTRUCTION_PIP,
        },
        {
            id: "uv",
            label: "uv",
            required: false,
            present: input.uv.present,
            version: input.uv.version,
            binary: input.uv.binary,
            consequence: "Нужен для установки MCP-сервера code-review-graph через uv pip install.",
            instructions: constants_1.INSTALLER_INSTRUCTION_UV,
        },
        {
            id: "gigacode",
            label: "gigacode",
            required: false,
            present: input.gigacode.present,
            version: input.gigacode.version,
            binary: input.gigacode.binary,
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
function formatCheck(check) {
    const showBinary = typeof check.binary === "string" &&
        check.binary.length > 0 &&
        check.binary !== check.label;
    const binarySuffix = showBinary ? ` (${check.binary})` : "";
    const versionSuffix = check.version ? ` — ${check.version}` : "";
    return `${check.label}${binarySuffix}${versionSuffix}`;
}
async function runPreflight() {
    const input = await probeEnvironment();
    const result = evaluatePreflight(input);
    print_1.print.section("Проверка окружения");
    for (const check of result.checks) {
        if (check.present) {
            print_1.print.success(formatCheck(check));
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
