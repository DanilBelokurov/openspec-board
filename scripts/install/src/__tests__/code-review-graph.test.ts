import { describe, expect, it } from "vitest";
import { PYTHON_CANDIDATES, resolvePython } from "../installers/code-review-graph";

describe("PYTHON_CANDIDATES", () => {
  it("puts the most recent versioned names first", () => {
    const index3_13 = PYTHON_CANDIDATES.indexOf("python3.13");
    const index3_12 = PYTHON_CANDIDATES.indexOf("python3.12");
    expect(index3_13).toBeGreaterThanOrEqual(0);
    expect(index3_12).toBeGreaterThanOrEqual(0);
    expect(index3_13).toBeLessThan(index3_12);
  });

  it("lists generic python3 and python as fallbacks at the end", () => {
    expect(PYTHON_CANDIDATES.indexOf("python3")).toBeGreaterThan(
      PYTHON_CANDIDATES.indexOf("python3.7"),
    );
    expect(PYTHON_CANDIDATES.at(-1)).toBe("python");
  });

  it("contains unique names", () => {
    expect(new Set(PYTHON_CANDIDATES).size).toBe(PYTHON_CANDIDATES.length);
  });
});

describe("resolvePython (live probe — depends on host PATH)", () => {
  it("either resolves a real python or returns present=false (no crash)", () => {
    const result = resolvePython();
    if (result.present) {
      expect(result.binary).toBeTruthy();
      expect(result.version).toBeTruthy();
    } else {
      expect(result.binary).toBeUndefined();
      expect(result.version).toBeUndefined();
    }
  });
});