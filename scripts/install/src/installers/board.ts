import { existsSync } from "node:fs";
import path from "node:path";
import { commandExists, runCommand } from "../shell";
import type { InstallMode } from "../constants";
import { print } from "../print";

export interface InstallBoardOptions {
  projectRoot: string;
  mode: InstallMode;
  force: boolean;
}

export function printRunDevInstructions(projectRoot: string, mode: InstallMode): void {
  print.blank();
  print.banner("✓ Доска SDD установлена");
  print.info(`Режим:  ${mode}`);
  print.info(`Проект: ${projectRoot}`);
  print.blank();

  print.card("Запуск локально", [
    `cd "${projectRoot}"`,
    "npm run dev",
  ]);

  print.blank();
  print.note("После старта Next.js по умолчанию слушает http://localhost:3000.");
  print.note("Если порт занят — ориентируйтесь на строку «Local:» в выводе next dev.");
  print.blank();
}

export async function installBoard(options: InstallBoardOptions): Promise<boolean> {
  const projectRoot = options.projectRoot;

  if (!commandExists("npm")) {
    print.warn("Не найден npm — установка зависимостей доски пропущена.");
    print.note(
      "Установите Node.js ≥ 18 и npm, затем выполните:\n" +
        `      cd ${projectRoot}\n` +
        "      npm install",
    );
    printRunDevInstructions(projectRoot, options.mode);
    return true;
  }

  if (!existsSync(path.join(projectRoot, "package.json"))) {
    print.warn(`Не найден ${projectRoot}/package.json — пропускаю npm install.`);
    printRunDevInstructions(projectRoot, options.mode);
    return true;
  }

  if (existsSync(path.join(projectRoot, "node_modules")) && !options.force) {
    print.dim(`node_modules уже установлены в ${projectRoot} — пропускаю npm install.`);
    print.dim("Для принудительной переустановки задайте INSTALLER_FORCE_REINSTALL_LOCKED=1 или --force.");
  } else {
    if (options.force) {
      print.warn("Принудительная переустановка npm-зависимостей (--force).");
    }
    print.step(`Выполняю npm install в ${projectRoot} ...`);
    const result = runCommand("npm", ["install"], { cwd: projectRoot, stdio: "inherit" });
    if (result.status !== 0) {
      print.error("npm install завершился с ошибкой — проверьте сетевой доступ к реестру npm.");
      printRunDevInstructions(projectRoot, options.mode);
      return true;
    }
    print.success("npm-зависимости доски установлены.");
  }

  printRunDevInstructions(projectRoot, options.mode);
  return true;
}