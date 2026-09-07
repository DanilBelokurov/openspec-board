import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isOnPath,
  renderSddLauncher,
  installSddLauncher,
} from "../binaries/sdd-launcher";

let scratchDir: string;

beforeEach(() => {
  scratchDir = mkdtempSync(path.join(tmpdir(), "sdd-launcher-test-"));
});

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("renderSddLauncher", () => {
  it("produces a script with shebang and the embedded board directory", () => {
    const source = renderSddLauncher("/Users/test/project");
    expect(source.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(source).toContain('SDD_BOARD_DIR = process.env.SDD_BOARD_DIR || "/Users/test/project"');
  });

  it("escapes backslashes in the embedded directory", () => {
    const source = renderSddLauncher(String.raw`C:\Users\test\board`);
    expect(source).toContain(String.raw`C:\\Users\\test\\board`);
  });

  it("escapes double quotes in the embedded directory", () => {
    const source = renderSddLauncher(`/tmp/quoted "path" dir`);
    expect(source).toContain(String.raw`/tmp/quoted \"path\" dir`);
  });

  it("supports --where flag and prints the configured directory", () => {
    const source = renderSddLauncher("/Users/test/project");
    expect(source).toContain("args.includes(\"--where\")");
  });

  it("supports --help flag", () => {
    const source = renderSddLauncher("/Users/test/project");
    expect(source).toContain("args.includes(\"--help\")");
  });

  it("forwards SIGINT/SIGTERM/SIGHUP to the npm child", () => {
    const source = renderSddLauncher("/Users/test/project");
    expect(source).toContain("SIGINT");
    expect(source).toContain("SIGTERM");
    expect(source).toContain("SIGHUP");
    expect(source).toContain("proc.kill");
  });

  it("uses SDD_BOARD_DIR env override when set", () => {
    const source = renderSddLauncher("/Users/test/project");
    expect(source).toContain("process.env.SDD_BOARD_DIR");
  });
});

describe("installSddLauncher", () => {
  it("writes the file to the target path and makes it executable", () => {
    const target = path.join(scratchDir, "sdd");
    const result = installSddLauncher("/Users/test/project", target);

    expect(result.path).toBe(target);
    expect(existsSync(target)).toBe(true);

    const stat = statSync(target);
    // 0o755 = rwxr-xr-x — executable for owner
    expect(stat.mode & 0o755).toBe(0o755);

    const content = readFileSync(target, "utf8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(content).toContain("/Users/test/project");
  });

  it("creates the parent directory if it does not exist", () => {
    const target = path.join(scratchDir, "deeply", "nested", "bin", "sdd");
    expect(existsSync(path.dirname(target))).toBe(false);
    installSddLauncher("/Users/test/project", target);
    expect(existsSync(target)).toBe(true);
  });

  it("is idempotent — re-running overwrites the existing file", () => {
    const target = path.join(scratchDir, "sdd");
    installSddLauncher("/Users/test/project", target);
    installSddLauncher("/Users/test/other", target);
    const content = readFileSync(target, "utf8");
    expect(content).toContain("/Users/test/other");
    expect(content).not.toContain("/Users/test/project");
  });
});

describe("isOnPath", () => {
  it("returns false for a directory that is not on PATH", () => {
    expect(isOnPath(scratchDir)).toBe(false);
  });

  it("returns true for a directory that matches a PATH entry", () => {
    const original = process.env.PATH ?? "";
    process.env.PATH = `${scratchDir}${path.delimiter}${original}`;
    try {
      expect(isOnPath(scratchDir)).toBe(true);
    } finally {
      process.env.PATH = original;
    }
  });
});