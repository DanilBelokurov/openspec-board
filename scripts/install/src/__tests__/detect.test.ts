import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectInstalledMcpServers, isMcpInstalled } from "../detect";
import { writeSettings } from "../settings";

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(tmpdir(), "sdd-detect-test-"));
});

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

describe("detectInstalledMcpServers", () => {
  it("returns [] when the file does not exist", () => {
    expect(detectInstalledMcpServers(path.join(scratchDir, "missing.json"))).toEqual([]);
  });

  it("returns [] on unparseable JSON (best-effort)", async () => {
    const target = path.join(scratchDir, "settings.json");
    await fs.writeFile(target, "not json");
    expect(detectInstalledMcpServers(target)).toEqual([]);
  });

  it("returns the mcpServers keys", async () => {
    const target = path.join(scratchDir, "settings.json");
    await writeSettings(target, {
      mcpServers: {
        "jira-mcp": { type: "streamable-http" },
        bitbucket: { command: "node" },
      },
    });
    expect(detectInstalledMcpServers(target).sort()).toEqual(["bitbucket", "jira-mcp"]);
  });
});

describe("isMcpInstalled", () => {
  it("returns true when the key is detected", () => {
    expect(isMcpInstalled(["jira-mcp", "bitbucket"], "bitbucket")).toBe(true);
  });

  it("returns false when the key is missing", () => {
    expect(isMcpInstalled(["jira-mcp"], "bitbucket")).toBe(false);
  });
});