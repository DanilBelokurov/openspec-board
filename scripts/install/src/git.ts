import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { runCommand } from "./shell";
import { print } from "./print";

export function cloneRepo(repoUrl: string, localDir: string, label: string): boolean {
  if (existsSync(localDir)) {
    if (existsSync(path.join(localDir, ".git"))) {
      print.dim(`Каталог ${localDir} уже содержит git-репозиторий — пропускаю клон.`);
      return true;
    }
    print.error(`Каталог ${localDir} существует, но не является git-репозиторием.`);
    return false;
  }
  mkdirSync(path.dirname(localDir), { recursive: true });
  print.step(`Клонирую ${repoUrl} в ${localDir} ...`);
  const result = runCommand("git", ["clone", "--depth", "1", repoUrl, localDir]);
  if (result.status !== 0) {
    print.error(`Не удалось склонировать ${repoUrl} — установка ${label} остановлена.`);
    return false;
  }
  return true;
}

export function buildNpmProject(buildDir: string, label: string): boolean {
  if (!existsSync(buildDir)) {
    print.error(`Каталог для сборки ${label} не найден: ${buildDir}`);
    return false;
  }
  print.step(`Запускаю npm install и npm run build в ${buildDir} ...`);
  const install = runCommand("npm", ["install"], { cwd: buildDir });
  if (install.status !== 0) {
    print.error(`Сборка ${label} в ${buildDir} завершилась с ошибкой — установка остановлена.`);
    return false;
  }
  const build = runCommand("npm", ["run", "build"], { cwd: buildDir });
  if (build.status !== 0) {
    print.error(`Сборка ${label} в ${buildDir} завершилась с ошибкой — установка остановлена.`);
    return false;
  }
  return true;
}