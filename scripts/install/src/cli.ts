#!/usr/bin/env node
import { Command, Option } from "commander";
import path from "node:path";
import { InstallCommand } from "./install";
import type { InstallMode } from "./constants";

const program = new Command();

program
  .name("sdd-board-install")
  .description(
    "Установка harness-окружения для доски sdd-sessions-board: MCP-серверы, режим работы, npm-зависимости.",
  )
  .version("0.1.0")
  .option("--project-root <path>", "Корень проекта доски (по умолчанию — родитель scripts/)")
  .option("--settings-file <path>", "Путь к ~/.gigacode/settings.json (для тестов)")
  .option(
    "--mode <mode>",
    "Режим установки: analyst-developer или uek-expert",
  )
  .option(
    "--tools <list>",
    "Список MCP через запятую: jira,bitbucket,sourcecontrol,sbertrack",
    (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean),
  )
  .option("--force", "Принудительная переустановка уже установленных MCP")
  .option("--non-interactive", "Не запрашивать интерактивный ввод")
  .option(
    "--token <token>",
    "Токен (используется вместе с --tools=<single-server>)",
  )
  .action(async (opts: {
    projectRoot?: string;
    settingsFile?: string;
    mode?: string;
    tools?: string[];
    force?: boolean;
    nonInteractive?: boolean;
    token?: string;
  }) => {
    const projectRoot =
      opts.projectRoot ?? path.resolve(__dirname, "..", "..", "..");
    const mode = opts.mode as InstallMode | undefined;

    if (mode && mode !== "analyst-developer" && mode !== "uek-expert") {
      console.error(`Неизвестный режим: ${mode}. Допустимо: analyst-developer, uek-expert`);
      process.exitCode = 2;
      return;
    }

    const tokenOverrides: Record<string, string> = {};
    if (opts.token && opts.tools && opts.tools.length === 1) {
      tokenOverrides[opts.tools[0]] = opts.token;
    }

    const cmd = new InstallCommand({
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Ошибка: ${message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});