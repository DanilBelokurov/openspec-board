import { describe, expect, it } from "vitest";
import { evaluatePreflight, type PreflightInput } from "../preflight";

function input(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    node: { present: true, version: "v20.5.0" },
    python: { present: true, version: "Python 3.12.0" },
    uv: { present: true, version: "uv 0.4.7" },
    gigacode: { present: true, version: "0.3.0" },
    ...overrides,
  };
}

describe("evaluatePreflight", () => {
  it("returns ok=true when every required tool is present", () => {
    const result = evaluatePreflight(input());
    expect(result.ok).toBe(true);
    expect(result.requiredMissing).toEqual([]);
    expect(result.optionalMissing).toEqual([]);
    expect(result.checks).toHaveLength(4);
  });

  it("returns ok=false with requiredMissing=node when node is absent", () => {
    const result = evaluatePreflight(
      input({ node: { present: false } }),
    );
    expect(result.ok).toBe(false);
    expect(result.requiredMissing).toEqual(["node"]);
  });

  it("lists optionalMissing tools (uv, gigacode) but keeps ok=true", () => {
    const result = evaluatePreflight(
      input({ uv: { present: false }, gigacode: { present: false } }),
    );
    expect(result.ok).toBe(true);
    expect(result.optionalMissing.sort()).toEqual(["gigacode", "uv"]);
  });

  it("populates label, required flag, and consequence for every tool", () => {
    const result = evaluatePreflight(input());
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    expect(byId.node.required).toBe(true);
    expect(byId.python.required).toBe(false);
    expect(byId.uv.required).toBe(false);
    expect(byId.gigacode.required).toBe(false);
    expect(byId.node.consequence).toBeTruthy();
    expect(byId.uv.consequence).toBeTruthy();
    expect(byId.uv.instructions).toBeTruthy();
    expect(byId.gigacode.consequence).toBeTruthy();
  });

  it("passes through the captured version string", () => {
    const result = evaluatePreflight(
      input({ gigacode: { present: true, version: "gigacode 1.2.3" } }),
    );
    const gigacode = result.checks.find((c) => c.id === "gigacode");
    expect(gigacode?.version).toBe("gigacode 1.2.3");
  });

  it("marks tool as present without a version when probe could not capture one", () => {
    const result = evaluatePreflight(
      input({ uv: { present: true } }),
    );
    const uv = result.checks.find((c) => c.id === "uv");
    expect(uv?.present).toBe(true);
    expect(uv?.version).toBeUndefined();
  });
});