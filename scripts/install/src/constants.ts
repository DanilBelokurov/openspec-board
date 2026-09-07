function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export const MCP_SOURCECONTROL_REPO_URL = envOrDefault(
  "MCP_SOURCECONTROL_REPO_URL",
  "https://api.sc-ci.sber.ru/DEVOPS/mcp-sourcecontrol.git",
);
export const MCP_SOURCECONTROL_API_URL = envOrDefault(
  "MCP_SOURCECONTROL_API_URL",
  "https://sc-ci.sber.ru",
);
export const MCP_SOURCECONTROL_LOCAL_DIR = envOrDefault(
  "MCP_SOURCECONTROL_LOCAL_DIR",
  ".mcp/sourcecontrol",
);
export const MCP_SOURCECONTROL_ENTRY = envOrDefault(
  "MCP_SOURCECONTROL_ENTRY",
  "mcp-sourcecontrol/dist/index.js",
);

export const MCP_BITBUCKET_REPO_URL = envOrDefault(
  "MCP_BITBUCKET_REPO_URL",
  "https://sc-ci.sber.ru/sc/InSourceHub_AI/ai_market",
);
export const MCP_BITBUCKET_API_URL = envOrDefault(
  "MCP_BITBUCKET_API_URL",
  "https://stash.sigma.sbrf.ru",
);
export const MCP_BITBUCKET_LOCAL_DIR = envOrDefault(
  "MCP_BITBUCKET_LOCAL_DIR",
  ".mcp/bitbucket-mcp",
);
export const MCP_BITBUCKET_SUBDIR = envOrDefault(
  "MCP_BITBUCKET_SUBDIR",
  "mcp/bitbucket-mcp",
);
export const MCP_BITBUCKET_ENTRY = envOrDefault(
  "MCP_BITBUCKET_ENTRY",
  "dist/index.js",
);
export const MCP_BITBUCKET_PERMISSION_TOOL = envOrDefault(
  "MCP_BITBUCKET_PERMISSION_TOOL",
  "mcp__bitbucket__create_pull_request",
);

export const INSTALLER_INSTRUCTION_UV = envOrDefault(
  "INSTALLER_INSTRUCTION_UV",
  "https://confluence.sberbank.ru/pages/viewpage.action?pageId=19332112007",
);
export const INSTALLER_INSTRUCTION_PIP = envOrDefault(
  "INSTALLER_INSTRUCTION_PIP",
  "https://sberusersoft/#program/v/287b424d-5558-4596-929a-aca7c5b277e0",
);
export const INSTALLER_INSTRUCTION_DEPS = envOrDefault(
  "INSTALLER_INSTRUCTION_DEPS",
  "https://mapp.sberbank.ru/sbersource/page/37558",
);

export const INSTALLER_INSTRUCTION_JIRA_TOKEN = envOrDefault(
  "INSTALLER_INSTRUCTION_JIRA_TOKEN",
  "https://mapp.sberbank.ru/ai-disrupt/page/118380#id-eibsZ4",
);
export const INSTALLER_INSTRUCTION_BITBUCKET_TOKEN = envOrDefault(
  "INSTALLER_INSTRUCTION_BITBUCKET_TOKEN",
  "https://example.com/get-bitbucket-token",
);
export const INSTALLER_INSTRUCTION_SOURCECONTROL_TOKEN = envOrDefault(
  "INSTALLER_INSTRUCTION_SOURCECONTROL_TOKEN",
  "https://example.com/get-sourcecontrol-token",
);
export const INSTALLER_INSTRUCTION_GIGACODE = envOrDefault(
  "INSTALLER_INSTRUCTION_GIGACODE",
  "https://example.com/get-gigacode-cli",
);

// URL the user provides for installing openspec manually when auto-install fails.
export const INSTALLER_INSTRUCTION_OPENSPEC = envOrDefault(
  "INSTALLER_INSTRUCTION_OPENSPEC",
  "https://example.com/install-openspec",
);

// Path to the local schema directory bundled with this repo.
// Copied verbatim into <sdd-store>/openspec/schemas/<name>/ on setup.
// Default is relative to the compiled installer's dist directory
// (scripts/install/dist/../../schemas/spec-driven-with-adr).
// Override with SCHEMA_SOURCE_PATH=<absolute path> when running
// the installer from a non-standard location.
export const SCHEMA_SOURCE_PATH = envOrDefault(
  "SCHEMA_SOURCE_PATH",
  "scripts/schemas/spec-driven-with-adr",
);

// Logical schema name, written into the sdd-store's openspec/config.yaml
// under the `schema:` key. The source directory above is expected to
// match this name (so the default resolves to scripts/schemas/<name>).
export const SDD_SCHEMA_NAME = envOrDefault(
  "SDD_SCHEMA_NAME",
  "spec-driven-with-adr",
);

export const CODE_REVIEW_GRAPH_PACKAGE = envOrDefault(
  "CODE_REVIEW_GRAPH_PACKAGE",
  "code-review-graph",
);
export const CODE_REVIEW_GRAPH_PERMISSION_TOOL = envOrDefault(
  "CODE_REVIEW_GRAPH_PERMISSION_TOOL",
  "mcp__code-review-graph__build_or_update_graph_tool",
);
export const CODE_REVIEW_GRAPH_SETTINGS_KEY = envOrDefault(
  "CODE_REVIEW_GRAPH_SETTINGS_KEY",
  "code-review-graph",
);

export const INSTALLER_FORCE_REINSTALL_LOCKED = process.env.INSTALLER_FORCE_REINSTALL_LOCKED === "1";

export type InstallMode = "analyst-developer" | "uek-expert";