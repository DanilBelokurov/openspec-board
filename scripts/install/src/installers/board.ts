import { existsSync } from "node:fs";
import path from "node:path";
import { commandExists, runCommand } from "../shell";
import type { InstallMode } from "../constants";

export interface InstallBoardOptions {
  projectRoot: string;
  mode: InstallMode;
  force: boolean;
}

export function printRunDevInstructions(projectRoot: string, mode: InstallMode): void {
  console.log("");
  console.log("=============================================================");
  console.log(`Доска SDD установлена (режим: ${mode}).`);
  console.log("");
  console.log("Чтобы запустить доску локально:");
  console.log("");
  console.log(`    cd "${projectRoot}"`);
  console.log("    npm run dev");
  console.log("");
  console.log(
    "После старта Next.js по умолчанию слушает http://localhost:3000 —",
  );
  console.log(
    "откройте этот адрес в браузере, чтобы увидеть UI доски.",
  );
  console.log(
    'Если порт занят, Next.js автоматически предложит следующий свободный',
  );
  console.log(
    'порт и напечатает его в терминале; ориентируйтесь на строку «Local:».',
  );
  console.log("");
}

export async function installBoard(options: InstallBoardOptions): Promise<boolean> {
  const projectRoot = options.projectRoot;

  if (!commandExists("npm")) {
    console.error(
      "Не найден npm — установка зависимостей доски пропущена.",
    );
    console.error(
      "Установите Node.js ≥ 18 и npm, затем выполните:\n    cd " +
        projectRoot +
        " && npm install",
    );
    printRunDevInstructions(projectRoot, options.mode);
    return true;
  }

  if (!existsSync(path.join(projectRoot, "package.json"))) {
    console.error(
      `Не найден ${projectRoot}/package.json — пропускаю npm install.`,
    );
    printRunDevInstructions(projectRoot, options.mode);
    return true;
  }

  if (existsSync(path.join(projectRoot, "node_modules")) && !options.force) {
    console.log(`node_modules уже установлены в ${projectRoot} — пропускаю npm install.`);
    console.log(" Для принудительной переустановки задайте INSTALLER_FORCE_REINSTALL_LOCKED=1.");
  } else {
    if (options.force) {
      console.log("INSTALLER_FORCE_REINSTALL_LOCKED=1 — переустанавливаю npm-зависимости.");
    }
    console.log(`Выполняю npm install в ${projectRoot} ...`);
    const result = runCommand("npm", ["install"], { cwd: projectRoot, stdio: "inherit" });
    if (result.status !== 0) {
      console.error(
        "npm install завершился с ошибкой — проверьте сетевой доступ к реестру npm.",
      );
      printRunDevInstructions(projectRoot, options.mode);
      return true;
    }
    console.log("npm-зависимости доски установлены.");
  }

  printRunDevInstructions(projectRoot, options.mode);
  return true;
}