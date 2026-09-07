import { describe, expect, it } from "vitest";
import { evaluatePreflight, type PreflightInput } from "../preflight";

function input(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    node: { present: true, binary: "node", version: "v20.5.0" },
    python: { present: true, binary: "python3", version: "Python 3.12.0" },
    uv: { present: true, binary: "uv", version: "uv 0.4.7" },
    gigacode: { present: true, binary: "gigacode", version: "0.3.0" },
    ...overrides,
  };
}

describe("evaluatePreflight", () => {
  it("returns ok=true when every tool is present", () => {
    const result = evaluatePreflight(input());
    expect(result.ok).toBe(true);
    expect(result.requiredMissing).toEqual([]);
    expect(result.optionalMissing).toEqual([]);
    expect(result.checks).toHaveLength(4);
  });

  it("returns ok=false with requiredMissing=[node] when node is absent", () => {
    const result = evaluatePreflight(
      input({ node: { present: false } }),
    );
    expect(result.ok).toBe(false);
    expect(result.requiredMissing).toEqual(["node"]);
  });

  it("returns ok=false with requiredMissing=[gigacode] when gigacode is absent", () => {
    const result = evaluatePreflight(
      input({ gigacode: { present: false } }),
    );
    expect(result.ok).toBe(false);
    expect(result.requiredMissing).toEqual(["gigacode"]);
  });

  it("returns ok=false with requiredMissing=[uv] when uv is absent", () => {
    const result = evaluatePreflight(
      input({ uv: { present: false } }),
    );
    expect(result.ok).toBe(false);
    expect(result.requiredMissing).toEqual(["uv"]);
  });

  it("returns ok=false listing all missing required tools at once", () => {
    const result = evaluatePreflight(
      input({
        node: { present: false },
        uv: { present: false },
        gigacode: { present: false },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.requiredMissing.sort()).toEqual(["gigacode", "node", "uv"]);
  });

  it("keeps ok=true and lists python as optionalMissing only when python is absent", () => {
    const result = evaluatePreflight(
      input({ python: { present: false } }),
    );
    expect(result.ok).toBe(true);
    expect(result.optionalMissing).toEqual(["python"]);
  });

  it("populates label, required flag, and consequence for every tool", () => {
    const result = evaluatePreflight(input());
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    expect(byId.node.required).toBe(true);
    expect(byId.python.required).toBe(false);
    expect(byId.uv.required).toBe(true);
    expect(byId.gigacode.required).toBe(true);
    expect(byId.node.consequence).toBeTruthy();
    expect(byId.uv.consequence).toBeTruthy();
    expect(byId.uv.instructions).toBeTruthy();
    expect(byId.gigacode.consequence).toBeTruthy();
    expect(byId.gigacode.instructions).toBeTruthy();
    expect(byId.python.consequence).toBeTruthy();
  });

  it("passes through the captured version string", () => {
    const result = evaluatePreflight(
      input({ gigacode: { present: true, binary: "gigacode", version: "gigacode 1.2.3" } }),
    );
    const gigacode = result.checks.find((c) => c.id === "gigacode");
    expect(gigacode?.version).toBe("gigacode 1.2.3");
  });

  it("marks tool as present without a version when probe could not capture one", () => {
    const result = evaluatePreflight(
      input({ uv: { present: true, binary: "uv" } }),
    );
    const uv = result.checks.find((c) => c.id === "uv");
    expect(uv?.present).toBe(true);
    expect(uv?.version).toBeUndefined();
  });

  it("preserves which python binary resolved the probe (python3.13 case)", () => {
    const result = evaluatePreflight(
      input({
        python: { present: true, binary: "python3.13", version: "Python 3.13.2" },
      }),
    );
    const python = result.checks.find((c) => c.id === "python");
    expect(python?.binary).toBe("python3.13");
    expect(python?.version).toBe("Python 3.13.2");
  });
});