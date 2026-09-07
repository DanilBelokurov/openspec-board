import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { runCommand } from "./shell";

export function cloneRepo(repoUrl: string, localDir: string, label: string): boolean {
  if (existsSync(localDir)) {
    if (existsSync(path.join(localDir, ".git"))) {
      console.log(`Каталог ${localDir} уже содержит git-репозиторий — пропускаю клон.`);
      return true;
    }
    console.error(`Каталог ${localDir} существует, но не является git-репозиторием.`);
    return false;
  }
  mkdirSync(path.dirname(localDir), { recursive: true });
  console.log(`Клонирую ${repoUrl} в ${localDir} ...`);
  const result = runCommand("git", ["clone", "--depth", "1", repoUrl, localDir]);
  if (result.status !== 0) {
    console.error(`Не удалось склонировать ${repoUrl} — установка ${label} остановлена.`);
    return false;
  }
  return true;
}

export function buildNpmProject(buildDir: string, label: string): boolean {
  if (!existsSync(buildDir)) {
    console.error(`Каталог для сборки ${label} не найден: ${buildDir}`);
    return false;
  }
  console.log(`Запускаю npm install и npm run build в ${buildDir} ...`);
  console.log(`(cd ${buildDir} && npm install)`);
  const install = runCommand("npm", ["install"], { cwd: buildDir });
  if (install.status !== 0) {
    console.error(`Сборка ${label} в ${buildDir} завершилась с ошибкой — установка остановлена.`);
    return false;
  }
  console.log(`(cd ${buildDir} && npm run build)`);
  const build = runCommand("npm", ["run", "build"], { cwd: buildDir });
  if (build.status !== 0) {
    console.error(`Сборка ${label} в ${buildDir} завершилась с ошибкой — установка остановлена.`);
    return false;
  }
  return true;
}