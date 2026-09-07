"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_OPENSPEC_INSTALL_ATTEMPTS = void 0;
exports.probeOpenspec = probeOpenspec;
exports.ensureOpenspec = ensureOpenspec;
const shell_1 = require("./shell");
const print_1 = require("./print");
exports.DEFAULT_OPENSPEC_INSTALL_ATTEMPTS = [
    {
        label: "npm install -g @fission-ai/openspec",
        bin: "npm",
        args: ["install", "-g", "@fission-ai/openspec"],
    },
    {
        label: "brew install openspec",
        bin: "brew",
        args: ["install", "openspec"],
    },
];
function probeOpenspec() {
    if (!(0, shell_1.commandExists)("openspec")) {
        return { present: false };
    }
    const result = (0, shell_1.runCommand)("openspec", ["--version"], { stdio: "pipe" });
    if (result.status !== 0) {
        return { present: true, binary: "openspec" };
    }
    const stream = (result.stdout || result.stderr || "").trim();
    const firstLine = stream.split("\n", 1)[0]?.trim() ?? "";
    return {
        present: true,
        binary: "openspec",
        version: firstLine || undefined,
    };
}
async function defaultSpawn(bin, args) {
    const result = (0, shell_1.runCommand)(bin, args, { stdio: "inherit" });
    return result.status ?? 1;
}
async function ensureOpenspec(options = {}) {
    const probe = options.probe ?? probeOpenspec;
    const attempts = options.attempts ?? exports.DEFAULT_OPENSPEC_INSTALL_ATTEMPTS;
    const hasBinary = options.hasBinary ?? shell_1.commandExists;
    const spawnImpl = options.spawn ?? defaultSpawn;
    const initial = probe();
    if (initial.present) {
        return { ...initial, installedNow: false };
    }
    print_1.print.info("openspec не найден — попытка установить.");
    for (const attempt of attempts) {
        if (!hasBinary(attempt.bin)) {
            print_1.print.dim(`Пропускаю «${attempt.label}» — нет ${attempt.bin} в PATH.`);
            continue;
        }
        print_1.print.step(`Попытка установить через ${attempt.label} ...`);
        let status;
        try {
            status = await spawnImpl(attempt.bin, attempt.args);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            print_1.print.warn(`Установка через ${attempt.label} упала с ошибкой: ${message}`);
            continue;
        }
        if (status === null || status !== 0) {
            print_1.print.warn(`Установка через ${attempt.label} завершилась с кодом ${status ?? "null"}.`);
            continue;
        }
        const after = probe();
        if (after.present) {
            print_1.print.success(`openspec установлен через ${attempt.label}` +
                (after.version ? ` — ${after.version}` : ""));
            return { ...after, installedNow: true };
        }
        print_1.print.warn(`Установка через ${attempt.label} отработала без ошибок, но openspec всё ещё не в PATH.`);
    }
    return { present: false, installedNow: false };
}
