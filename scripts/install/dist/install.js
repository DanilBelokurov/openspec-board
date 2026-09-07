"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstallCommand = void 0;
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
class InstallCommand {
    options;
    constructor(options) {
        this.options = options;
    }
    async run() {
        print_1.print.banner("sdd-board install", "установка harness-окружения для доски sdd-sessions-board");
        const preflight = await (0, preflight_1.runPreflight)();
        if (!preflight.ok) {
            process.exitCode = 1;
            return;
        }
        await this.installSelectedMcps();
        const mode = await (0, mode_1.selectInstallMode)(this.options.nonInteractive, this.options.modeOverride);
        if (mode === "analyst-developer") {
            print_1.print.section("Code-review-graph MCP");
            await (0, code_review_graph_1.installCodeReviewGraphMcp)({
                settingsFilePath: this.settingsFilePath,
                force: this.options.force,
            });
        }
        await (0, board_1.installBoard)({
            projectRoot: this.options.projectRoot,
            mode,
            force: this.options.force,
        });
    }
    get settingsFilePath() {
        return this.options.settingsFilePath ?? (0, settings_1.getSettingsPath)();
    }
    async installSelectedMcps() {
        print_1.print.section("MCP-серверы");
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
