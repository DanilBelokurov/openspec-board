import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ensureMcpServersSection,
  ensureObject,
  ensurePermissionsSection,
  readSettings,
  writeSettings,
  type SettingsShape,
} from "../settings";

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(tmpdir(), "sdd-settings-test-"));
});

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

describe("readSettings", () => {
  it("returns {} when the file does not exist", () => {
    const result = readSettings(path.join(scratchDir, "missing.json"));
    expect(result).toEqual({});
  });

  it("returns {} when the file is empty (only whitespace)", async () => {
    const target = path.join(scratchDir, "settings.json");
    await fs.writeFile(target, "  \n  ");
    expect(readSettings(target)).toEqual({});
  });

  it("parses valid JSON content", async () => {
    const target = path.join(scratchDir, "settings.json");
    await fs.writeFile(target, JSON.stringify({ mcpServers: { x: { command: "node" } } }));
    expect(readSettings(target)).toEqual({
      mcpServers: { x: { command: "node" } },
    });
  });

  it("throws on non-object root (array)", async () => {
    const target = path.join(scratchDir, "settings.json");
    await fs.writeFile(target, "[]");
    expect(() => readSettings(target)).toThrow(/JSON-объект/);
  });

  it("throws on non-object root (string)", async () => {
    const target = path.join(scratchDir, "settings.json");
    await fs.writeFile(target, '"hello"');
    expect(() => readSettings(target)).toThrow(/JSON-объект/);
  });
});

describe("ensureObject", () => {
  it("accepts plain objects", () => {
    expect(() => ensureObject({}, "msg")).not.toThrow();
    expect(() => ensureObject({ a: 1 }, "msg")).not.toThrow();
  });

  it("rejects null, arrays, primitives", () => {
    expect(() => ensureObject(null, "msg")).toThrow();
    expect(() => ensureObject([], "msg")).toThrow();
    expect(() => ensureObject("hi", "msg")).toThrow();
    expect(() => ensureObject(42, "msg")).toThrow();
  });
});

describe("writeSettings", () => {
  it("creates parent dirs and writes JSON atomically with mode 0600", async () => {
    const target = path.join(scratchDir, "nested", "settings.json");
    await writeSettings(target, { foo: "bar" });

    const stat = await fs.stat(target);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual({ foo: "bar" });
  });

  it("round-trips through readSettings", async () => {
    const target = path.join(scratchDir, "settings.json");
    const input: SettingsShape = {
      mcpServers: { jira: { type: "streamable-http" } },
      permissions: { allow: ["run_shell_command"] },
    };
    await writeSettings(target, input);
    expect(readSettings(target)).toEqual(input);
  });
});

describe("ensureMcpServersSection", () => {
  it("creates the section if missing", async () => {
    const settings: SettingsShape = {};
    await ensureMcpServersSection("x.json", settings);
    expect(settings.mcpServers).toEqual({});
  });

  it("throws when mcpServers is an array", async () => {
    const settings = { mcpServers: [] } as unknown as SettingsShape;
    await expect(ensureMcpServersSection("x.json", settings)).rejects.toThrow(
      /mcpServers/,
    );
  });
});

describe("ensurePermissionsSection", () => {
  it("creates permissions and allow array when missing", async () => {
    const settings: SettingsShape = {};
    await ensurePermissionsSection(settings);
    expect(settings.permissions).toEqual({ allow: [] });
  });

  it("throws if allow contains non-strings", async () => {
    const settings = {
      permissions: { allow: ["ok", 1] },
    } as unknown as SettingsShape;
    await expect(ensurePermissionsSection(settings)).rejects.toThrow(
      /только строки/,
    );
  });
});