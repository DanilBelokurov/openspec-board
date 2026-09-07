#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const node_path_1 = __importDefault(require("node:path"));
const install_1 = require("./install");
const program = new commander_1.Command();
program
    .name("sdd-board-install")
    .description("Установка harness-окружения для доски sdd-sessions-board: MCP-серверы, режим работы, npm-зависимости.")
    .version("0.1.0")
    .option("--project-root <path>", "Корень проекта доски (по умолчанию — родитель scripts/)")
    .option("--settings-file <path>", "Путь к ~/.gigacode/settings.json (для тестов)")
    .option("--mode <mode>", "Режим установки: analyst-developer или uek-expert")
    .option("--tools <list>", "Список MCP через запятую: jira,bitbucket,sourcecontrol,sbertrack", (value) => value.split(",").map((s) => s.trim()).filter(Boolean))
    .option("--force", "Принудительная переустановка уже установленных MCP")
    .option("--non-interactive", "Не запрашивать интерактивный ввод")
    .option("--token <token>", "Токен (используется вместе с --tools=<single-server>)")
    .action(async (opts) => {
    const projectRoot = opts.projectRoot ?? node_path_1.default.resolve(__dirname, "..", "..", "..");
    const mode = opts.mode;
    if (mode && mode !== "analyst-developer" && mode !== "uek-expert") {
        console.error(`Неизвестный режим: ${mode}. Допустимо: analyst-developer, uek-expert`);
        process.exitCode = 2;
        return;
    }
    const tokenOverrides = {};
    if (opts.token && opts.tools && opts.tools.length === 1) {
        tokenOverrides[opts.tools[0]] = opts.token;
    }
    const cmd = new install_1.InstallCommand({
        projectRoot,
        settingsFilePath: opts.settingsFile,
        force: Boolean(opts.force),
        nonInteractive: Boolean(opts.nonInteractive),
        modeOverride: mode,
        toolsOverride: opts.tools,
        tokenOverrides,
    });
    try {
        await cmd.run();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Ошибка: ${message}`);
        process.exitCode = 1;
    }
});
program.parseAsync(process.argv).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
