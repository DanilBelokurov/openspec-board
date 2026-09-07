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
  print.raw("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  print.raw(`  Доска SDD установлена  ·  режим: ${mode}\n`);
  print.raw("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  print.raw("\n");
  print.raw("  Чтобы запустить доску локально:\n");
  print.raw("\n");
  print.raw(`      cd "${projectRoot}"\n`);
  print.raw("      npm run dev\n");
  print.raw("\n");
  print.raw("  После старта Next.js по умолчанию слушает http://localhost:3000 —\n");
  print.raw("  откройте этот адрес в браузере, чтобы увидеть UI доски.\n");
  print.raw("  Если порт занят, Next.js автоматически предложит следующий\n");
  print.raw("  свободный порт (ориентируйтесь на строку «Local:»).\n");
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