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
const print_1 = require("../print");
function printRunDevInstructions(projectRoot, mode) {
    print_1.print.blank();
    print_1.print.raw("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    print_1.print.raw(`  Доска SDD установлена  ·  режим: ${mode}\n`);
    print_1.print.raw("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    print_1.print.raw("\n");
    print_1.print.raw("  Чтобы запустить доску локально:\n");
    print_1.print.raw("\n");
    print_1.print.raw(`      cd "${projectRoot}"\n`);
    print_1.print.raw("      npm run dev\n");
    print_1.print.raw("\n");
    print_1.print.raw("  После старта Next.js по умолчанию слушает http://localhost:3000 —\n");
    print_1.print.raw("  откройте этот адрес в браузере, чтобы увидеть UI доски.\n");
    print_1.print.raw("  Если порт занят, Next.js автоматически предложит следующий\n");
    print_1.print.raw("  свободный порт (ориентируйтесь на строку «Local:»).\n");
    print_1.print.blank();
}
async function installBoard(options) {
    const projectRoot = options.projectRoot;
    if (!(0, shell_1.commandExists)("npm")) {
        print_1.print.warn("Не найден npm — установка зависимостей доски пропущена.");
        print_1.print.note("Установите Node.js ≥ 18 и npm, затем выполните:\n" +
            `      cd ${projectRoot}\n` +
            "      npm install");
        printRunDevInstructions(projectRoot, options.mode);
        return true;
    }
    if (!(0, node_fs_1.existsSync)(node_path_1.default.join(projectRoot, "package.json"))) {
        print_1.print.warn(`Не найден ${projectRoot}/package.json — пропускаю npm install.`);
        printRunDevInstructions(projectRoot, options.mode);
        return true;
    }
    if ((0, node_fs_1.existsSync)(node_path_1.default.join(projectRoot, "node_modules")) && !options.force) {
        print_1.print.dim(`node_modules уже установлены в ${projectRoot} — пропускаю npm install.`);
        print_1.print.dim("Для принудительной переустановки задайте INSTALLER_FORCE_REINSTALL_LOCKED=1 или --force.");
    }
    else {
        if (options.force) {
            print_1.print.warn("Принудительная переустановка npm-зависимостей (--force).");
        }
        print_1.print.step(`Выполняю npm install в ${projectRoot} ...`);
        const result = (0, shell_1.runCommand)("npm", ["install"], { cwd: projectRoot, stdio: "inherit" });
        if (result.status !== 0) {
            print_1.print.error("npm install завершился с ошибкой — проверьте сетевой доступ к реестру npm.");
            printRunDevInstructions(projectRoot, options.mode);
            return true;
        }
        print_1.print.success("npm-зависимости доски установлены.");
    }
    printRunDevInstructions(projectRoot, options.mode);
    return true;
}
