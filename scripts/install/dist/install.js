"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstallCommand = void 0;
exports.showInstallationInfo = showInstallationInfo;
const catalog_1 = require("./catalog");
const detect_1 = require("./detect");
const permissions_1 = require("./permissions");
const prompts_1 = require("./prompts");
const mode_1 = require("./mode");
const board_1 = require("./installers/board");
const code_review_graph_1 = require("./installers/code-review-graph");
const index_1 = require("./installers/index");
const settings_1 = require("./settings");
function showInstallationInfo() {
    console.log("Будет установлено всё необходимое harness-окружение для работы доски sdd.");
    console.log("");
}
class InstallCommand {
    options;
    constructor(options) {
        this.options = options;
    }
    async run() {
        showInstallationInfo();
        await this.installSelectedMcps();
        const mode = await (0, mode_1.selectInstallMode)(this.options.nonInteractive, this.options.modeOverride);
        if (mode === "analyst-developer") {
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
        if (lockedRawValues.length > 0 && !this.options.force) {
            console.error("Уже установленные (●) будут пропущены.");
            console.error(" Для принудительной переустановки задайте INSTALLER_FORCE_REINSTALL_LOCKED=1.");
        }
        if (this.options.force) {
            console.error(`INSTALLER_FORCE_REINSTALL_LOCKED=1 — принудительная переустановка включена.`);
        }
        let chosen;
        if (this.options.toolsOverride && this.options.toolsOverride.length > 0) {
            chosen = this.options.toolsOverride;
        }
        else if (this.options.nonInteractive) {
            chosen = lockedRawValues.length > 0 ? lockedRawValues : [];
        }
        else {
            chosen = await (0, prompts_1.selectCheckboxes)("Какие MCP-серверы установить?", checkboxOptions);
        }
        const effective = this.options.force
            ? chosen
            : chosen.filter((name) => !lockedRawValues.includes(name));
        const skippedLocked = chosen.filter((name) => lockedRawValues.includes(name));
        if (skippedLocked.length > 0) {
            console.log(`Пропущено (уже установлено): ${skippedLocked.join(" ")}`);
        }
        if (effective.length === 0) {
            if (chosen.length > 0) {
                console.log("Все выбранные серверы уже установлены — переустановка не требуется.");
            }
            else {
                console.log("Ни один MCP-сервер не выбран.");
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
