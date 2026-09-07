import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type SetupSddStoreDeps,
  type SpawnFn,
  setupSddStore,
} from "../sdd-store";

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(tmpdir(), "sdd-store-test-"));
});

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

interface SpawnCall {
  bin: string;
  args: string[];
  cwd: string;
}

function makeSpawn(
  plan: Array<{ bin: string; args?: string[]; status: number | null }>,
): { spawn: SpawnFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  let i = 0;
  const spawn: SpawnFn = async (bin, args, options) => {
    calls.push({ bin, args, cwd: options.cwd });
    const step = plan[i++];
    if (!step) return { status: 1, stdout: "", stderr: "no more steps" };
    return { status: step.status, stdout: "", stderr: "" };
  };
  return { spawn, calls };
}

async function makeSourceFixture(): Promise<string> {
  const source = path.join(scratchDir, "schema-src");
  await fs.mkdir(path.join(source, "templates"), { recursive: true });
  await fs.writeFile(
    path.join(source, "schema.yaml"),
    "name: spec-driven-with-adr\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(source, "templates", "proposal.md"),
    "# proposal template\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(source, ".DS_Store"),
    "macos metadata noise\n",
    "utf8",
  );
  return source;
}

describe("setupSddStore — local schema copy", () => {
  it("returns ok=false when storePath does not exist", async () => {
    const missing = path.join(scratchDir, "does-not-exist");
    const { spawn } = makeSpawn([]);
    const result = await setupSddStore(
      { storePath: missing, storeName: "my-store" },
      { spawn, hasBinary: () => true },
    );
    expect(result.ok).toBe(false);
    expect(result.initialized).toBe(false);
    expect(result.storeRegistered).toBe(false);
    expect(result.schemaInstalled).toBe(false);
  });

  it("returns ok=false when openspec is missing", async () => {
    const storeDir = path.join(scratchDir, "store");
    await fs.mkdir(storeDir, { recursive: true });
    const { spawn } = makeSpawn([]);
    const result = await setupSddStore(
      { storePath: storeDir, storeName: "my-store" },
      { spawn, hasBinary: () => false },
    );
    expect(result.ok).toBe(false);
    expect(result.initialized).toBe(false);
  });

  it("runs openspec init, store setup, and config set defaultStore in the right cwd", async () => {
    const storeDir = path.join(scratchDir, "store");
    await fs.mkdir(storeDir, { recursive: true });
    const source = await makeSourceFixture();

    const { spawn, calls } = makeSpawn([
      { bin: "openspec", args: ["init", ".", "--tools=none"], status: 0 },
      { bin: "openspec", args: ["store", "setup", "my-store", "--path", storeDir], status: 0 },
      { bin: "openspec", args: ["config", "set", "defaultStore", "my-store"], status: 0 },
      { bin: "git", args: ["add", "."], status: 0 },
      { bin: "git", args: ["commit", "-m", "chore: install spec-drive-with-adr schema"], status: 0 },
      { bin: "git", args: ["branch", "--show-current"], status: 0 },
    ]);
    const wrappedSpawn: SpawnFn = async (bin, args, options) => {
      const r = await spawn(bin, args, options);
      if (bin === "git" && args[0] === "branch" && args[1] === "--show-current") {
        return { status: 0, stdout: "master\n", stderr: "" };
      }
      return r;
    };

    const result = await setupSddStore(
      { storePath: storeDir, storeName: "my-store", schemaSourcePath: source },
      { spawn: wrappedSpawn, hasBinary: () => true },
    );

    expect(result.initialized).toBe(true);
    expect(result.storeRegistered).toBe(true);
    expect(result.defaultStoreSet).toBe(true);
    expect(result.schemaInstalled).toBe(true);
    expect(result.configUpdated).toBe(false);
    expect(calls[0]).toEqual({
      bin: "openspec",
      args: ["init", ".", "--tools=none"],
      cwd: storeDir,
    });
    expect(calls[1].cwd).toBe(storeDir);
    expect(calls[1].bin).toBe("openspec");
    expect(calls[2]).toEqual({
      bin: "openspec",
      args: ["config", "set", "defaultStore", "my-store"],
      cwd: storeDir,
    });
  });

  it("copies schema files from local source to <store>/openspec/schemas/<name>/", async () => {
    const storeDir = path.join(scratchDir, "store");
    await fs.mkdir(storeDir, { recursive: true });
    const source = await makeSourceFixture();

    const { spawn } = makeSpawn([
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 0 },
      { bin: "git", status: 0 },
      { bin: "git", status: 0 },
      { bin: "git", status: 0 },
    ]);
    const wrappedSpawn: SpawnFn = async (bin, args, options) => {
      const r = await spawn(bin, args, options);
      if (bin === "git" && args[0] === "branch" && args[1] === "--show-current") {
        return { status: 0, stdout: "master\n", stderr: "" };
      }
      return r;
    };

    const result = await setupSddStore(
      { storePath: storeDir, storeName: "my-store", schemaSourcePath: source },
      { spawn: wrappedSpawn, hasBinary: () => true },
    );

    expect(result.schemaInstalled).toBe(true);
    const target = path.join(storeDir, "openspec", "schemas", "spec-driven-with-adr");
    expect(await fs.stat(target).then((s) => s.isDirectory())).toBe(true);
    const schemaYaml = await fs.readFile(path.join(target, "schema.yaml"), "utf8");
    expect(schemaYaml).toContain("spec-driven-with-adr");
    const proposal = await fs.readFile(path.join(target, "templates", "proposal.md"), "utf8");
    expect(proposal).toContain("proposal template");
  });

  it("filters out .DS_Store during schema copy", async () => {
    const storeDir = path.join(scratchDir, "store");
    await fs.mkdir(storeDir, { recursive: true });
    const source = await makeSourceFixture();

    const { spawn } = makeSpawn([
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 0 },
      { bin: "git", status: 0 },
      { bin: "git", status: 0 },
      { bin: "git", status: 0 },
    ]);
    const wrappedSpawn: SpawnFn = async (bin, args, options) => {
      const r = await spawn(bin, args, options);
      if (bin === "git" && args[0] === "branch" && args[1] === "--show-current") {
        return { status: 0, stdout: "master\n", stderr: "" };
      }
      return r;
    };

    await setupSddStore(
      { storePath: storeDir, storeName: "my-store", schemaSourcePath: source },
      { spawn: wrappedSpawn, hasBinary: () => true },
    );

    const target = path.join(storeDir, "openspec", "schemas", "spec-driven-with-adr");
    await expect(fs.stat(path.join(target, ".DS_Store"))).rejects.toThrow();
  });

  it("returns schemaInstalled=false when source path is null", async () => {
    const storeDir = path.join(scratchDir, "store");
    await fs.mkdir(storeDir, { recursive: true });
    const { spawn } = makeSpawn([
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 0 },
      { bin: "git", status: 0 },
      { bin: "git", status: 0 },
      { bin: "git", status: 0 },
    ]);
    const wrappedSpawn: SpawnFn = async (bin, args, options) => {
      const r = await spawn(bin, args, options);
      if (bin === "git" && args[0] === "branch" && args[1] === "--show-current") {
        return { status: 0, stdout: "master\n", stderr: "" };
      }
      return r;
    };

    const result = await setupSddStore(
      {
        storePath: storeDir,
        storeName: "my-store",
        schemaSourcePath: "/definitely/does/not/exist",
      },
      { spawn: wrappedSpawn, hasBinary: () => true },
    );

    expect(result.schemaInstalled).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("returns schemaInstalled=false when copySchema throws", async () => {
    const storeDir = path.join(scratchDir, "store");
    await fs.mkdir(storeDir, { recursive: true });
    const { spawn } = makeSpawn([
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 0 },
    ]);
    const wrappedSpawn: SpawnFn = async (bin, args, options) => {
      const r = await spawn(bin, args, options);
      return r;
    };

    const result = await setupSddStore(
      {
        storePath: storeDir,
        storeName: "my-store",
        schemaSourcePath: path.join(scratchDir, "any-existing-dir"),
        copySchema: async () => {
          throw new Error("disk full");
        },
      },
      { spawn: wrappedSpawn, hasBinary: () => true },
    );

    expect(result.schemaInstalled).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("stops at openspec init failure (no store setup, no copy)", async () => {
    const storeDir = path.join(scratchDir, "store");
    await fs.mkdir(storeDir, { recursive: true });
    const source = await makeSourceFixture();
    const copyCalls: string[] = [];

    const { spawn } = makeSpawn([{ bin: "openspec", status: 1 }]);
    const result = await setupSddStore(
      { storePath: storeDir, storeName: "my-store", schemaSourcePath: source },
      {
        spawn,
        hasBinary: () => true,
      },
    );

    expect(result.initialized).toBe(false);
    expect(result.storeRegistered).toBe(false);
    expect(result.schemaInstalled).toBe(false);
    expect(copyCalls).toEqual([]);
  });

  it("stops at openspec store setup failure (no copy, no commit)", async () => {
    const storeDir = path.join(scratchDir, "store");
    await fs.mkdir(storeDir, { recursive: true });
    const source = await makeSourceFixture();
    const { spawn } = makeSpawn([
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 1 },
    ]);
    const result = await setupSddStore(
      { storePath: storeDir, storeName: "my-store", schemaSourcePath: source },
      { spawn, hasBinary: () => true },
    );
    expect(result.initialized).toBe(true);
    expect(result.storeRegistered).toBe(false);
    expect(result.schemaInstalled).toBe(false);
    expect(result.committedToMaster).toBe(false);
  });

  it("renames branch to master when current branch is not master", async () => {
    const storeDir = path.join(scratchDir, "store");
    await fs.mkdir(storeDir, { recursive: true });
    const source = await makeSourceFixture();
    const { spawn, calls } = makeSpawn([
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 0 },
      { bin: "git", status: 0 },
      { bin: "git", status: 0 },
      { bin: "git", status: 0 }, // branch --show-current
      { bin: "git", status: 0 }, // branch -M master
    ]);
    const wrappedSpawn: SpawnFn = async (bin, args, options) => {
      const r = await spawn(bin, args, options);
      if (bin === "git" && args[0] === "branch" && args[1] === "--show-current") {
        return { status: 0, stdout: "main\n", stderr: "" };
      }
      return r;
    };
    await setupSddStore(
      { storePath: storeDir, storeName: "my-store", schemaSourcePath: source },
      { spawn: wrappedSpawn, hasBinary: () => true },
    );
    const lastCall = calls[calls.length - 1];
    expect(lastCall.bin).toBe("git");
    expect(lastCall.args).toEqual(["branch", "-M", "master"]);
  });

  it("ok=true when every step succeeds including config update", async () => {
    const storeDir = path.join(scratchDir, "store");
    await fs.mkdir(path.join(storeDir, "openspec"), { recursive: true });
    await fs.writeFile(
      path.join(storeDir, "openspec", "config.yaml"),
      "schema: spec-driven\n",
      "utf8",
    );
    const source = await makeSourceFixture();
    const { spawn } = makeSpawn([
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 0 },
      { bin: "openspec", status: 0 },
      { bin: "git", status: 0 },
      { bin: "git", status: 0 },
      { bin: "git", status: 0 },
    ]);
    const wrappedSpawn: SpawnFn = async (bin, args, options) => {
      const r = await spawn(bin, args, options);
      if (bin === "git" && args[0] === "branch" && args[1] === "--show-current") {
        return { status: 0, stdout: "master\n", stderr: "" };
      }
      return r;
    };
    const result = await setupSddStore(
      { storePath: storeDir, storeName: "my-store", schemaSourcePath: source },
      { spawn: wrappedSpawn, hasBinary: () => true },
    );
    expect(result.initialized).toBe(true);
    expect(result.storeRegistered).toBe(true);
    expect(result.defaultStoreSet).toBe(true);
    expect(result.schemaInstalled).toBe(true);
    expect(result.configUpdated).toBe(true);
    expect(result.committedToMaster).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("stops at openspec config set defaultStore failure (no copy, no commit)", async () => {
    const storeDir = path.join(scratchDir, "store");
    await fs.mkdir(storeDir, { recursive: true });
    const source = await makeSourceFixture();
    const { spawn } = makeSpawn([
      { bin: "openspec", status: 0 }, // init
      { bin: "openspec", status: 0 }, // store setup
      { bin: "openspec", status: 1 }, // config set defaultStore
    ]);
    const result = await setupSddStore(
      { storePath: storeDir, storeName: "my-store", schemaSourcePath: source },
      { spawn, hasBinary: () => true },
    );
    expect(result.initialized).toBe(true);
    expect(result.storeRegistered).toBe(true);
    expect(result.defaultStoreSet).toBe(false);
    expect(result.schemaInstalled).toBe(false);
    expect(result.committedToMaster).toBe(false);
    expect(result.ok).toBe(false);
  });
});

describe("config.yaml mutation (real file)", () => {
  it("replaces existing schema line and persists to disk", async () => {
    const storeDir = path.join(scratchDir, "store");
    await fs.mkdir(path.join(storeDir, "openspec"), { recursive: true });
    const configPath = path.join(storeDir, "openspec", "config.yaml");
    await fs.writeFile(
      configPath,
      ["schema: spec-driven", "other: keep", ""].join("\n"),
      "utf8",
    );
    const raw = await fs.readFile(configPath, "utf8");
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/^schema:\s*/.test(lines[i])) {
        lines[i] = "schema: spec-drive-with-adr";
        break;
      }
    }
    await fs.writeFile(configPath, lines.join("\n"), "utf8");

    const updated = await fs.readFile(configPath, "utf8");
    expect(updated).toContain("schema: spec-drive-with-adr");
    expect(updated).toContain("other: keep");
    expect(updated).not.toContain("spec-driven");
  });
});