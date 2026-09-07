"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloneRepo = cloneRepo;
exports.buildNpmProject = buildNpmProject;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const shell_1 = require("./shell");
function cloneRepo(repoUrl, localDir, label) {
    if ((0, node_fs_1.existsSync)(localDir)) {
        if ((0, node_fs_1.existsSync)(node_path_1.default.join(localDir, ".git"))) {
            console.log(`Каталог ${localDir} уже содержит git-репозиторий — пропускаю клон.`);
            return true;
        }
        console.error(`Каталог ${localDir} существует, но не является git-репозиторием.`);
        return false;
    }
    (0, node_fs_1.mkdirSync)(node_path_1.default.dirname(localDir), { recursive: true });
    console.log(`Клонирую ${repoUrl} в ${localDir} ...`);
    const result = (0, shell_1.runCommand)("git", ["clone", "--depth", "1", repoUrl, localDir]);
    if (result.status !== 0) {
        console.error(`Не удалось склонировать ${repoUrl} — установка ${label} остановлена.`);
        return false;
    }
    return true;
}
function buildNpmProject(buildDir, label) {
    if (!(0, node_fs_1.existsSync)(buildDir)) {
        console.error(`Каталог для сборки ${label} не найден: ${buildDir}`);
        return false;
    }
    console.log(`Запускаю npm install и npm run build в ${buildDir} ...`);
    console.log(`(cd ${buildDir} && npm install)`);
    const install = (0, shell_1.runCommand)("npm", ["install"], { cwd: buildDir });
    if (install.status !== 0) {
        console.error(`Сборка ${label} в ${buildDir} завершилась с ошибкой — установка остановлена.`);
        return false;
    }
    console.log(`(cd ${buildDir} && npm run build)`);
    const build = (0, shell_1.runCommand)("npm", ["run", "build"], { cwd: buildDir });
    if (build.status !== 0) {
        console.error(`Сборка ${label} в ${buildDir} завершилась с ошибкой — установка остановлена.`);
        return false;
    }
    return true;
}
