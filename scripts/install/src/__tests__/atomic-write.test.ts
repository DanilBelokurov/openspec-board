import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomicWriteJson } from "../atomic-write";

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(tmpdir(), "sdd-install-test-"));
});

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

describe("atomicWriteJson", () => {
  it("writes JSON pretty-printed with a trailing newline", async () => {
    const target = path.join(scratchDir, "settings.json");
    await atomicWriteJson(target, { foo: 1, bar: "baz" });

    const raw = await fs.readFile(target, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual({ foo: 1, bar: "baz" });
  });

  it("creates the file with mode 0600 by default", async () => {
    const target = path.join(scratchDir, "settings.json");
    await atomicWriteJson(target, { hello: "world" });

    const stat = await fs.stat(target);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("honours a custom mode override", async () => {
    const target = path.join(scratchDir, "settings.json");
    await atomicWriteJson(target, { x: 1 }, { mode: 0o644 });

    const stat = await fs.stat(target);
    expect(stat.mode & 0o777).toBe(0o644);
  });

  it("does not leave a .tmp file behind on success", async () => {
    const target = path.join(scratchDir, "settings.json");
    await atomicWriteJson(target, { ok: true });

    const entries = await fs.readdir(scratchDir);
    expect(entries).toEqual(["settings.json"]);
  });

  it("supports omitting the trailing newline", async () => {
    const target = path.join(scratchDir, "settings.json");
    await atomicWriteJson(target, { compact: true }, { trailingNewline: false });

    const raw = await fs.readFile(target, "utf8");
    expect(raw.endsWith("\n")).toBe(false);
  });

  it("overwrites an existing file", async () => {
    const target = path.join(scratchDir, "settings.json");
    await atomicWriteJson(target, { v: 1 });
    await atomicWriteJson(target, { v: 2 });

    const raw = await fs.readFile(target, "utf8");
    expect(JSON.parse(raw)).toEqual({ v: 2 });
  });
});