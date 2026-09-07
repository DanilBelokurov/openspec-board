import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENSPEC_INSTALL_ATTEMPTS,
  ensureOpenspec,
  probeOpenspec,
  type InstallAttempt,
} from "../openspec";

describe("probeOpenspec (live probe — depends on host PATH)", () => {
  it("either finds openspec or returns present=false (never crashes)", () => {
    const result = probeOpenspec();
    if (result.present) {
      expect(result.binary).toBe("openspec");
    } else {
      expect(result.binary).toBeUndefined();
    }
  });
});

describe("ensureOpenspec", () => {
  it("returns installedNow=false when openspec is already present (no install attempted)", async () => {
    let spawnCalls = 0;
    const result = await ensureOpenspec({
      probe: () => ({ present: true, binary: "openspec", version: "0.5.0" }),
      attempts: [
        { label: "should-not-run", bin: "true", args: ["--version"] },
      ],
      hasBinary: () => true,
      spawn: () => {
        spawnCalls++;
        return 0;
      },
    });

    expect(result.present).toBe(true);
    expect(result.installedNow).toBe(false);
    expect(result.version).toBe("0.5.0");
    expect(spawnCalls).toBe(0);
  });

  it("returns installedNow=true when install succeeds and re-probe finds openspec", async () => {
    let probeCalls = 0;
    const result = await ensureOpenspec({
      probe: () => {
        probeCalls++;
        return probeCalls === 1
          ? { present: false }
          : { present: true, binary: "openspec", version: "0.6.1" };
      },
      attempts: [{ label: "fake-install", bin: "npm", args: ["install", "-g", "@fission-ai/openspec"] }],
      hasBinary: () => true,
      spawn: () => 0,
    });

    expect(result.present).toBe(true);
    expect(result.installedNow).toBe(true);
    expect(result.version).toBe("0.6.1");
  });

  it("skips attempts whose required bin is absent", async () => {
    let spawnCalls = 0;
    const result = await ensureOpenspec({
      probe: () => ({ present: false }),
      attempts: [
        { label: "no-bin", bin: "missing-tool", args: [] },
      ],
      hasBinary: (b) => b !== "missing-tool",
      spawn: () => {
        spawnCalls++;
        return 0;
      },
    });

    expect(result.present).toBe(false);
    expect(result.installedNow).toBe(false);
    expect(spawnCalls).toBe(0);
  });

  it("tries the next attempt if the first install reports a non-zero exit", async () => {
    let spawnCalls = 0;
    const result = await ensureOpenspec({
      probe: () => ({ present: false }),
      attempts: [
        { label: "first", bin: "fake", args: [] },
        { label: "second", bin: "fake", args: [] },
      ],
      hasBinary: () => true,
      spawn: () => {
        spawnCalls++;
        return 1;
      },
    });

    expect(result.present).toBe(false);
    expect(result.installedNow).toBe(false);
    expect(spawnCalls).toBe(2);
  });

  it("returns present=false when install returns 0 but openspec is still not on PATH", async () => {
    let spawnCalls = 0;
    const result = await ensureOpenspec({
      probe: () => ({ present: false }),
      attempts: [{ label: "silent-failure", bin: "fake", args: [] }],
      hasBinary: () => true,
      spawn: () => {
        spawnCalls++;
        return 0;
      },
    });

    expect(result.present).toBe(false);
    expect(result.installedNow).toBe(false);
    expect(spawnCalls).toBe(1);
  });

  it("aborts the attempt loop early when one attempt successfully installs", async () => {
    let spawnCalls = 0;
    let probeCalls = 0;
    const result = await ensureOpenspec({
      probe: () => {
        probeCalls++;
        return probeCalls === 2
          ? { present: true, binary: "openspec", version: "0.7.0" }
          : { present: false };
      },
      attempts: [
        { label: "works", bin: "fake", args: [] },
        { label: "never-called", bin: "fake", args: [] },
      ],
      hasBinary: () => true,
      spawn: () => {
        spawnCalls++;
        return 0;
      },
    });

    expect(result.installedNow).toBe(true);
    expect(result.version).toBe("0.7.0");
    expect(spawnCalls).toBe(1);
  });

  it("treats a thrown spawn as a non-fatal install failure and continues", async () => {
    let spawnCalls = 0;
    const result = await ensureOpenspec({
      probe: () => ({ present: false }),
      attempts: [
        { label: "throws", bin: "fake", args: [] },
        { label: "throws-too", bin: "fake", args: [] },
      ],
      hasBinary: () => true,
      spawn: () => {
        spawnCalls++;
        throw new Error("boom");
      },
    });

    expect(result.present).toBe(false);
    expect(result.installedNow).toBe(false);
    expect(spawnCalls).toBe(2);
  });
});

describe("DEFAULT_OPENSPEC_INSTALL_ATTEMPTS", () => {
  it("includes both npm-global and brew strategies", () => {
    const labels = DEFAULT_OPENSPEC_INSTALL_ATTEMPTS.map((a: InstallAttempt) => a.label);
    expect(labels.some((l) => l.includes("npm"))).toBe(true);
    expect(labels.some((l) => l.includes("brew"))).toBe(true);
  });

  it("every attempt has label, bin, args array", () => {
    for (const attempt of DEFAULT_OPENSPEC_INSTALL_ATTEMPTS) {
      expect(typeof attempt.label).toBe("string");
      expect(attempt.label.length).toBeGreaterThan(0);
      expect(typeof attempt.bin).toBe("string");
      expect(Array.isArray(attempt.args)).toBe(true);
    }
  });
});