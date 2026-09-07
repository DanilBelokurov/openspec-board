"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchMcpInstall = dispatchMcpInstall;
const catalog_1 = require("../catalog");
const jira_1 = require("./jira");
const bitbucket_1 = require("./bitbucket");
const sourcecontrol_1 = require("./sourcecontrol");
const sbertrack_1 = require("./sbertrack");
async function dispatchMcpInstall(rawValue, context, tokenOverride) {
    const entry = (0, catalog_1.findCatalogEntryByRaw)(rawValue);
    if (!entry) {
        console.error(`Неизвестный сервер: ${rawValue}`);
        return "failed";
    }
    let ok = false;
    switch (rawValue) {
        case "jira":
            ok = await (0, jira_1.installJiraMcp)({
                settingsFilePath: context.settingsFilePath,
                token: tokenOverride,
            });
            break;
        case "bitbucket":
            ok = await (0, bitbucket_1.installBitbucketMcp)({
                settingsFilePath: context.settingsFilePath,
                token: tokenOverride,
            });
            break;
        case "sourcecontrol":
            ok = await (0, sourcecontrol_1.installSourcecontrolMcp)({
                settingsFilePath: context.settingsFilePath,
                token: tokenOverride,
            });
            break;
        case "sbertrack":
            ok = (0, sbertrack_1.installSbertrackMcp)();
            break;
        default:
            console.error(`Неизвестный сервер: ${rawValue}`);
            return "failed";
    }
    if (!ok) {
        console.error(`Установка ${rawValue}-mcp не завершена — продолжаю.`);
        return "failed";
    }
    return "installed";
}
