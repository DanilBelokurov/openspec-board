import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  reconcileMcpServerKeys,
  registerPermissionTool,
  syncRequiredPermissions,
} from "../permissions";
import { readSettings, writeSettings } from "../settings";

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(tmpdir(), "sdd-perm-test-"));
});

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

function fixture(name: string): string {
  return path.join(scratchDir, name);
}

describe("registerPermissionTool", () => {
  it("creates permissions.allow when missing", async () => {
    const target = fixture("settings.json");
    await writeSettings(target, { foo: "bar" });

    await registerPermissionTool(target, "mcp__jira-mcp__add_labels");

    const settings = readSettings(target);
    expect(settings.permissions?.allow).toEqual(["mcp__jira-mcp__add_labels"]);
  });

  it("appends without duplicating", async () => {
    const target = fixture("settings.json");
    await writeSettings(target, {
      permissions: { allow: ["mcp__jira-mcp__add_labels"] },
    });

    await registerPermissionTool(target, "mcp__jira-mcp__add_labels");
    await registerPermissionTool(target, "mcp__bitbucket__create_pull_request");

    const settings = readSettings(target);
    expect(settings.permissions?.allow).toEqual([
      "mcp__jira-mcp__add_labels",
      "mcp__bitbucket__create_pull_request",
    ]);
  });
});

describe("reconcileMcpServerKeys", () => {
  it("promotes a foreign jira alias to jira-mcp", async () => {
    const target = fixture("settings.json");
    await writeSettings(target, {
      mcpServers: {
        "jira-staging": {
          type: "streamable-http",
          httpUrl: "https://api.sbertrack.sberbank.ru/jira/mcp",
        },
      },
    });

    const result = await reconcileMcpServerKeys(target);
    expect(result.changed).toBe(true);
    expect(result.rewrites).toEqual([{ from: "jira-staging", to: "jira-mcp" }]);

    const settings = readSettings(target);
    expect(Object.keys(settings.mcpServers!)).toEqual(["jira-mcp"]);
    expect(settings.mcpServers!["jira-mcp"].httpUrl).toBe(
      "https://api.sbertrack.sberbank.ru/jira/mcp",
    );
  });

  it("drops foreign keys when canonical already exists", async () => {
    const target = fixture("settings.json");
    await writeSettings(target, {
      mcpServers: {
        "jira-mcp": { type: "streamable-http", httpUrl: "https://api/jira/mcp" },
        "jira-old": { type: "streamable-http", httpUrl: "https://other/jira/mcp" },
      },
    });

    const result = await reconcileMcpServerKeys(target);
    expect(result.removedDuplicates).toEqual(["jira-old"]);

    const settings = readSettings(target);
    expect(Object.keys(settings.mcpServers!)).toEqual(["jira-mcp"]);
    expect(settings.mcpServers!["jira-mcp"].httpUrl).toBe("https://api/jira/mcp");
  });

  it("does not touch bitbucket entries without BITBUCKET_TOKEN env", async () => {
    const target = fixture("settings.json");
    await writeSettings(target, {
      mcpServers: {
        "my-bb": { command: "node", args: ["x.js"], env: {} },
      },
    });

    const result = await reconcileMcpServerKeys(target);
    expect(result.changed).toBe(false);
    expect(Object.keys(readSettings(target).mcpServers!)).toEqual(["my-bb"]);
  });

  it("promotes a bitbucket entry with BITBUCKET_TOKEN env", async () => {
    const target = fixture("settings.json");
    await writeSettings(target, {
      mcpServers: {
        "stash-bb": {
          command: "node",
          args: ["dist/index.js"],
          env: { BITBUCKET_URL: "x", BITBUCKET_TOKEN: "y" },
        },
      },
    });

    const result = await reconcileMcpServerKeys(target);
    expect(result.rewrites).toEqual([{ from: "stash-bb", to: "bitbucket" }]);
  });
});

describe("syncRequiredPermissions", () => {
  it("adds missing tools for installed MCPs", async () => {
    const target = fixture("settings.json");
    await writeSettings(target, {
      mcpServers: { "jira-mcp": { type: "streamable-http" } },
    });

    const result = await syncRequiredPermissions(target);
    expect(result.added).toEqual(["mcp__jira-mcp__add_labels"]);
    expect(readSettings(target).permissions?.allow).toEqual(["mcp__jira-mcp__add_labels"]);
  });

  it("skips MCPs that are not installed", async () => {
    const target = fixture("settings.json");
    await writeSettings(target, {
      mcpServers: { "something-else": { command: "x" } },
    });

    const result = await syncRequiredPermissions(target);
    expect(result.added).toEqual([]);
  });

  it("does not duplicate existing permissions", async () => {
    const target = fixture("settings.json");
    await writeSettings(target, {
      mcpServers: { "jira-mcp": { type: "streamable-http" } },
      permissions: { allow: ["mcp__jira-mcp__add_labels"] },
    });

    const result = await syncRequiredPermissions(target);
    expect(result.added).toEqual([]);
    expect(readSettings(target).permissions?.allow).toEqual([
      "mcp__jira-mcp__add_labels",
    ]);
  });
});