"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstallCommand = void 0;
const node_path_1 = __importDefault(require("node:path"));
const catalog_1 = require("./catalog");
const detect_1 = require("./detect");
const permissions_1 = require("./permissions");
const prompts_1 = require("./prompts");
const mode_1 = require("./mode");
const board_1 = require("./installers/board");
const code_review_graph_1 = require("./installers/code-review-graph");
const index_1 = require("./installers/index");
const settings_1 = require("./settings");
const preflight_1 = require("./preflight");
const print_1 = require("./print");
const sdd_launcher_1 = require("./binaries/sdd-launcher");
const sdd_store_1 = require("./sdd-store");
class InstallCommand {
    options;
    constructor(options) {
        this.options = options;
    }
    async run() {
        print_1.print.banner("sdd-board install", "установка harness-окружения для доски sdd-sessions-board");
        const preflight = await (0, preflight_1.runPreflight)();
        if (!preflight.ok) {
            process.exit(1);
        }
        await this.installSelectedMcps();
        const mode = await (0, mode_1.selectInstallMode)(this.options.nonInteractive, this.options.modeOverride);
        if (mode === "analyst-developer") {
            print_1.print.section("⚡", "Code-review-graph MCP");
            await (0, code_review_graph_1.installCodeReviewGraphMcp)({
                settingsFilePath: this.settingsFilePath,
                force: this.options.force,
            });
            await this.setupSddStore();
        }
        await (0, board_1.installBoard)({
            projectRoot: this.options.projectRoot,
            mode,
            force: this.options.force,
        });
        this.installSddCommand();
        process.exit(0);
    }
    installSddCommand() {
        print_1.print.section("▶", "Команда sdd");
        const result = (0, sdd_launcher_1.installSddLauncher)(this.options.projectRoot);
        if (result.onPath) {
            print_1.print.success(`sdd → ${result.path}`);
            print_1.print.note("Откройте новый терминал и введите 'sdd' для запуска доски.");
        }
        else {
            const binDir = node_path_1.default.dirname(result.path);
            print_1.print.warn(`sdd установлена, но ${binDir} не в PATH.`);
            print_1.print.note("Добавьте строку ниже в ваш ~/.zshrc или ~/.bashrc:");
            print_1.print.note(`  export PATH="${binDir}:$PATH"`);
            print_1.print.note("После этого откройте новый терминал и введите 'sdd'.");
        }
        print_1.print.blank();
    }
    async setupSddStore() {
        (0, sdd_store_1.printSddStoreIntro)();
        let storePath = this.options.sddStorePath;
        let storeName = this.options.sddStoreName;
        if (!storePath) {
            if (this.options.nonInteractive) {
                print_1.print.error("--non-interactive требует --store-path=<путь> и --store-name=<название>");
                process.exit(1);
            }
            storePath = await (0, prompts_1.promptForText)("Путь к локальной директории sdd-store", "Абсолютный путь к пустой (или свежей) папке, например ~/projects/sdd-store-specs", undefined);
        }
        if (!storeName) {
            if (this.options.nonInteractive) {
                print_1.print.error("--non-interactive требует --store-path=<путь> и --store-name=<название>");
                process.exit(1);
            }
            storeName = await (0, prompts_1.promptForText)("Название sdd-store", "Короткое имя для openspec store setup, например sdd-store", undefined);
        }
        const result = await (0, sdd_store_1.setupSddStore)({
            storePath,
            storeName,
        });
        if (result.ok) {
            print_1.print.success(`sdd-store готов: ${result.storeName} → ${result.storePath}`);
        }
        else {
            print_1.print.warn("Настройка sdd-store завершилась с ошибками — проверьте журнал выше.");
        }
        print_1.print.blank();
    }
    get settingsFilePath() {
        return this.options.settingsFilePath ?? (0, settings_1.getSettingsPath)();
    }
    async installSelectedMcps() {
        print_1.print.section("⬢", "MCP-серверы");
        await (0, permissions_1.reconcileMcpServerKeys)(this.settingsFilePath);
        const detectedKeys = (0, detect_1.detectInstalledMcpServers)(this.settingsFilePath);
        const lockedRawValues = [];
        const checkboxOptions = catalog_1.MCP_CATALOG_ENTRIES.map((entry) => {
            const isInstalled = (0, detect_1.isMcpInstalled)(detectedKeys, entry.settingsKey);
            if (isInstalled)
                lockedRawValues.push(entry.rawValue);
            return {
                label: isInstalled ? `${entry.displayLabel} (уже установлен)` : entry.displayLabel,
                value: entry.rawValue,
                locked: isInstalled,
            };
        });
        if (this.options.force) {
            print_1.print.warn("Принудительная переустановка включена (--force).");
        }
        let chosen;
        if (this.options.toolsOverride && this.options.toolsOverride.length > 0) {
            chosen = this.options.toolsOverride;
            print_1.print.info(`Выбраны MCP через --tools: ${chosen.join(", ")}`);
        }
        else if (this.options.nonInteractive) {
            chosen = lockedRawValues.length > 0 ? lockedRawValues : [];
            if (chosen.length === 0) {
                print_1.print.info("--non-interactive и нет установленных MCP — пропускаю выбор.");
            }
        }
        else {
            chosen = await (0, prompts_1.selectCheckboxes)("Какие MCP-серверы установить?", checkboxOptions);
        }
        const effective = this.options.force
            ? chosen
            : chosen.filter((name) => !lockedRawValues.includes(name));
        const skippedLocked = chosen.filter((name) => lockedRawValues.includes(name));
        if (skippedLocked.length > 0) {
            print_1.print.dim(`Пропущено (уже установлено): ${skippedLocked.join(", ")}`);
        }
        if (effective.length === 0) {
            if (chosen.length > 0) {
                print_1.print.info("Все выбранные серверы уже установлены — переустановка не требуется.");
            }
            else {
                print_1.print.info("Ни один MCP-сервер не выбран.");
            }
            await (0, permissions_1.syncRequiredPermissions)(this.settingsFilePath);
            return;
        }
        for (const name of effective) {
            const token = this.options.tokenOverrides?.[name];
            await (0, index_1.dispatchMcpInstall)(name, { settingsFilePath: this.settingsFilePath }, token);
        }
        await (0, permissions_1.syncRequiredPermissions)(this.settingsFilePath);
    }
}
exports.InstallCommand = InstallCommand;
