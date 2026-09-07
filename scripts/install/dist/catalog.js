"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCP_CATALOG_ENTRIES = void 0;
exports.findCatalogEntryByKey = findCatalogEntryByKey;
exports.findCatalogEntryByRaw = findCatalogEntryByRaw;
exports.MCP_CATALOG_ENTRIES = [
    {
        rawValue: "jira",
        settingsKey: "jira-mcp",
        displayLabel: "jira",
        permissions: ["mcp__jira-mcp__add_labels"],
        matcher: (entry) => typeof entry.httpUrl === "string" && /\/jira\/mcp(\b|$)/.test(entry.httpUrl),
    },
    {
        rawValue: "sbertrack",
        settingsKey: "sbertrack",
        displayLabel: "sbertrack (в процессе добавления)",
        permissions: [],
    },
    {
        rawValue: "bitbucket",
        settingsKey: "bitbucket",
        displayLabel: "bitbucket",
        permissions: ["mcp__bitbucket__create_pull_request"],
        matcher: (entry) => {
            if (!entry || entry.command !== "node")
                return false;
            const env = entry.env;
            if (!env || typeof env !== "object")
                return false;
            return Boolean(env.BITBUCKET_TOKEN || env.BITBUCKET_URL);
        },
    },
    {
        rawValue: "sourcecontrol",
        settingsKey: "sourcecontrol",
        displayLabel: "sourcecontrol",
        permissions: ["mcp__sourcecontrol__git_create_pull_request"],
        matcher: (entry) => {
            if (!entry || entry.command !== "node")
                return false;
            const env = entry.env;
            if (!env || typeof env !== "object")
                return false;
            return Boolean(env.SC_API_URL || env.SC_TOKEN);
        },
    },
];
function findCatalogEntryByKey(settingsKey) {
    return exports.MCP_CATALOG_ENTRIES.find((entry) => entry.settingsKey === settingsKey);
}
function findCatalogEntryByRaw(rawValue) {
    return exports.MCP_CATALOG_ENTRIES.find((entry) => entry.rawValue === rawValue);
}
