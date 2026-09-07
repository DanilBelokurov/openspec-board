"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.printRunDevInstructions = printRunDevInstructions;
exports.installBoard = installBoard;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const shell_1 = require("../shell");
function printRunDevInstructions(projectRoot, mode) {
    console.log("");
    console.log("=============================================================");
    console.log(`Доска SDD установлена (режим: ${mode}).`);
    console.log("");
    console.log("Чтобы запустить доску локально:");
    console.log("");
    console.log(`    cd "${projectRoot}"`);
    console.log("    npm run dev");
    console.log("");
    console.log("После старта Next.js по умолчанию слушает http://localhost:3000 —");
    console.log("откройте этот адрес в браузере, чтобы увидеть UI доски.");
    console.log('Если порт занят, Next.js автоматически предложит следующий свободный');
    console.log('порт и напечатает его в терминале; ориентируйтесь на строку «Local:».');
    console.log("");
}
async function installBoard(options) {
    const projectRoot = options.projectRoot;
    if (!(0, shell_1.commandExists)("npm")) {
        console.error("Не найден npm — установка зависимостей доски пропущена.");
        console.error("Установите Node.js ≥ 18 и npm, затем выполните:\n    cd " +
            projectRoot +
            " && npm install");
        printRunDevInstructions(projectRoot, options.mode);
        return true;
    }
    if (!(0, node_fs_1.existsSync)(node_path_1.default.join(projectRoot, "package.json"))) {
        console.error(`Не найден ${projectRoot}/package.json — пропускаю npm install.`);
        printRunDevInstructions(projectRoot, options.mode);
        return true;
    }
    if ((0, node_fs_1.existsSync)(node_path_1.default.join(projectRoot, "node_modules")) && !options.force) {
        console.log(`node_modules уже установлены в ${projectRoot} — пропускаю npm install.`);
        console.log(" Для принудительной переустановки задайте INSTALLER_FORCE_REINSTALL_LOCKED=1.");
    }
    else {
        if (options.force) {
            console.log("INSTALLER_FORCE_REINSTALL_LOCKED=1 — переустанавливаю npm-зависимости.");
        }
        console.log(`Выполняю npm install в ${projectRoot} ...`);
        const result = (0, shell_1.runCommand)("npm", ["install"], { cwd: projectRoot, stdio: "inherit" });
        if (result.status !== 0) {
            console.error("npm install завершился с ошибкой — проверьте сетевой доступ к реестру npm.");
            printRunDevInstructions(projectRoot, options.mode);
            return true;
        }
        console.log("npm-зависимости доски установлены.");
    }
    printRunDevInstructions(projectRoot, options.mode);
    return true;
}
