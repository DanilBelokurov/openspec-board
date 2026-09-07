import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { updateBoardConfig, resolveBoardConfigPath } from "../board-config";

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(tmpdir(), "board-config-test-"));
});

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

async function writeBoardConfig(
  boardRoot: string,
  contents: Record<string, unknown>,
): Promise<string> {
  const dir = path.join(boardRoot, ".sdd-board");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "config.json");
  await fs.writeFile(filePath, JSON.stringify(contents, null, 2), "utf8");
  return filePath;
}

describe("resolveBoardConfigPath", () => {
  it("returns <root>/.sdd-board/config.json", () => {
    expect(resolveBoardConfigPath("/Users/foo/board")).toBe(
      path.join("/Users/foo/board", ".sdd-board", "config.json"),
    );
  });
});

describe("updateBoardConfig", () => {
  it("returns found=false when config.json does not exist", async () => {
    const result = await updateBoardConfig(scratchDir, {
      openspecDir: "/some/path",
    });
    expect(result.found).toBe(false);
    expect(result.changed).toBe(false);
  });

  it("sets openspecDir and persists to disk", async () => {
    await writeBoardConfig(scratchDir, {
      openspecDir: "",
      mode: "uek-expert",
    });

    const result = await updateBoardConfig(scratchDir, {
      openspecDir: "/Users/you/projects/sdd-store-specs",
    });

    expect(result.found).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.previous.openspecDir).toBe("");
    expect(result.current.openspecDir).toBe("/Users/you/projects/sdd-store-specs");
    expect(result.current.mode).toBe("uek-expert");

    const onDisk = JSON.parse(
      await fs.readFile(path.join(scratchDir, ".sdd-board", "config.json"), "utf8"),
    );
    expect(onDisk.openspecDir).toBe("/Users/you/projects/sdd-store-specs");
    expect(onDisk.mode).toBe("uek-expert");
  });

  it("sets sddStoreName alongside openspecDir", async () => {
    await writeBoardConfig(scratchDir, { openspecDir: "", mode: "developer" });

    const result = await updateBoardConfig(scratchDir, {
      openspecDir: "/p",
      sddStoreName: "my-sdd-store",
    });

    expect(result.current.openspecDir).toBe("/p");
    expect(result.current.sddStoreName).toBe("my-sdd-store");
  });

  it("is a no-op when both fields already match", async () => {
    await writeBoardConfig(scratchDir, {
      openspecDir: "/existing",
      mode: "developer",
    });

    const result = await updateBoardConfig(scratchDir, { openspecDir: "/existing" });

    expect(result.changed).toBe(false);
  });

  it("preserves unrelated fields (mode, repos, defaultBranch)", async () => {
    await writeBoardConfig(scratchDir, {
      openspecDir: "",
      mode: "analyst-developer",
      defaultBranch: "master",
      repos: { "my-repo": { url: "https://example.com/r.git", branch: "main" } },
    });

    await updateBoardConfig(scratchDir, { openspecDir: "/new" });

    const onDisk = JSON.parse(
      await fs.readFile(path.join(scratchDir, ".sdd-board", "config.json"), "utf8"),
    );
    expect(onDisk.openspecDir).toBe("/new");
    expect(onDisk.mode).toBe("analyst-developer");
    expect(onDisk.defaultBranch).toBe("master");
    expect(onDisk.repos["my-repo"]).toEqual({
      url: "https://example.com/r.git",
      branch: "main",
    });
  });

  it("survives bad JSON (does not overwrite with empty)", async () => {
    const dir = path.join(scratchDir, ".sdd-board");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "config.json");
    await fs.writeFile(filePath, "not json at all", "utf8");

    const result = await updateBoardConfig(scratchDir, { openspecDir: "/x" });

    expect(result.found).toBe(true);
    expect(result.changed).toBe(false);
    expect(await fs.readFile(filePath, "utf8")).toBe("not json at all");
  });

  it("ignores undefined values in updates", async () => {
    await writeBoardConfig(scratchDir, { openspecDir: "/x", mode: "developer" });

    const result = await updateBoardConfig(scratchDir, {
      openspecDir: undefined,
      sddStoreName: "store-1",
    });

    expect(result.changed).toBe(true);
    expect(result.current.openspecDir).toBe("/x");
    expect(result.current.sddStoreName).toBe("store-1");
  });

  it("preserves a permission-preserving write (file remains readable)", async () => {
    await writeBoardConfig(scratchDir, { openspecDir: "", mode: "uek-expert" });

    await updateBoardConfig(scratchDir, { openspecDir: "/new" });

    const onDisk = await fs.readFile(
      path.join(scratchDir, ".sdd-board", "config.json"),
      "utf8",
    );
    const parsed = JSON.parse(onDisk);
    expect(parsed.openspecDir).toBe("/new");
  });
});