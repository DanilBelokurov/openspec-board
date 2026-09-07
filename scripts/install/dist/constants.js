"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INSTALLER_FORCE_REINSTALL_LOCKED = exports.CODE_REVIEW_GRAPH_SETTINGS_KEY = exports.CODE_REVIEW_GRAPH_PERMISSION_TOOL = exports.CODE_REVIEW_GRAPH_PACKAGE = exports.INSTALLER_INSTRUCTION_SOURCECONTROL_TOKEN = exports.INSTALLER_INSTRUCTION_BITBUCKET_TOKEN = exports.INSTALLER_INSTRUCTION_JIRA_TOKEN = exports.INSTALLER_INSTRUCTION_DEPS = exports.INSTALLER_INSTRUCTION_PIP = exports.INSTALLER_INSTRUCTION_UV = exports.MCP_BITBUCKET_PERMISSION_TOOL = exports.MCP_BITBUCKET_ENTRY = exports.MCP_BITBUCKET_SUBDIR = exports.MCP_BITBUCKET_LOCAL_DIR = exports.MCP_BITBUCKET_API_URL = exports.MCP_BITBUCKET_REPO_URL = exports.MCP_SOURCECONTROL_ENTRY = exports.MCP_SOURCECONTROL_LOCAL_DIR = exports.MCP_SOURCECONTROL_API_URL = exports.MCP_SOURCECONTROL_REPO_URL = void 0;
function envOrDefault(name, fallback) {
    const value = process.env[name];
    return value && value.length > 0 ? value : fallback;
}
exports.MCP_SOURCECONTROL_REPO_URL = envOrDefault("MCP_SOURCECONTROL_REPO_URL", "https://api.sc-ci.sber.ru/DEVOPS/mcp-sourcecontrol.git");
exports.MCP_SOURCECONTROL_API_URL = envOrDefault("MCP_SOURCECONTROL_API_URL", "https://sc-ci.sber.ru");
exports.MCP_SOURCECONTROL_LOCAL_DIR = envOrDefault("MCP_SOURCECONTROL_LOCAL_DIR", ".mcp/sourcecontrol");
exports.MCP_SOURCECONTROL_ENTRY = envOrDefault("MCP_SOURCECONTROL_ENTRY", "mcp-sourcecontrol/dist/index.js");
exports.MCP_BITBUCKET_REPO_URL = envOrDefault("MCP_BITBUCKET_REPO_URL", "https://sc-ci.sber.ru/sc/InSourceHub_AI/ai_market");
exports.MCP_BITBUCKET_API_URL = envOrDefault("MCP_BITBUCKET_API_URL", "https://stash.sigma.sbrf.ru");
exports.MCP_BITBUCKET_LOCAL_DIR = envOrDefault("MCP_BITBUCKET_LOCAL_DIR", ".mcp/bitbucket-mcp");
exports.MCP_BITBUCKET_SUBDIR = envOrDefault("MCP_BITBUCKET_SUBDIR", "mcp/bitbucket-mcp");
exports.MCP_BITBUCKET_ENTRY = envOrDefault("MCP_BITBUCKET_ENTRY", "dist/index.js");
exports.MCP_BITBUCKET_PERMISSION_TOOL = envOrDefault("MCP_BITBUCKET_PERMISSION_TOOL", "mcp__bitbucket__create_pull_request");
exports.INSTALLER_INSTRUCTION_UV = envOrDefault("INSTALLER_INSTRUCTION_UV", "https://confluence.sberbank.ru/pages/viewpage.action?pageId=19332112007");
exports.INSTALLER_INSTRUCTION_PIP = envOrDefault("INSTALLER_INSTRUCTION_PIP", "https://sberusersoft/#program/v/287b424d-5558-4596-929a-aca7c5b277e0");
exports.INSTALLER_INSTRUCTION_DEPS = envOrDefault("INSTALLER_INSTRUCTION_DEPS", "https://mapp.sberbank.ru/sbersource/page/37558");
exports.INSTALLER_INSTRUCTION_JIRA_TOKEN = envOrDefault("INSTALLER_INSTRUCTION_JIRA_TOKEN", "https://mapp.sberbank.ru/ai-disrupt/page/118380#id-eibsZ4");
exports.INSTALLER_INSTRUCTION_BITBUCKET_TOKEN = envOrDefault("INSTALLER_INSTRUCTION_BITBUCKET_TOKEN", "https://example.com/get-bitbucket-token");
exports.INSTALLER_INSTRUCTION_SOURCECONTROL_TOKEN = envOrDefault("INSTALLER_INSTRUCTION_SOURCECONTROL_TOKEN", "https://example.com/get-sourcecontrol-token");
exports.CODE_REVIEW_GRAPH_PACKAGE = envOrDefault("CODE_REVIEW_GRAPH_PACKAGE", "code-review-graph");
exports.CODE_REVIEW_GRAPH_PERMISSION_TOOL = envOrDefault("CODE_REVIEW_GRAPH_PERMISSION_TOOL", "mcp__code-review-graph__build_or_update_graph_tool");
exports.CODE_REVIEW_GRAPH_SETTINGS_KEY = envOrDefault("CODE_REVIEW_GRAPH_SETTINGS_KEY", "code-review-graph");
exports.INSTALLER_FORCE_REINSTALL_LOCKED = process.env.INSTALLER_FORCE_REINSTALL_LOCKED === "1";
