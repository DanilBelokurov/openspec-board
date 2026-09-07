import { describe, expect, it } from "vitest";
import {
  PIP_CANDIDATES,
  PYTHON_CANDIDATES,
  resolvePip,
  resolvePython,
} from "../binaries";

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

describe("PIP_CANDIDATES", () => {
  it("mirrors the python candidate ordering (most-recent versioned first)", () => {
    const index3_13 = PIP_CANDIDATES.indexOf("pip3.13");
    const index3_12 = PIP_CANDIDATES.indexOf("pip3.12");
    expect(index3_13).toBeGreaterThanOrEqual(0);
    expect(index3_12).toBeGreaterThanOrEqual(0);
    expect(index3_13).toBeLessThan(index3_12);
  });

  it("lists pip3 and pip as fallbacks at the end", () => {
    expect(PIP_CANDIDATES.indexOf("pip3")).toBeGreaterThan(
      PIP_CANDIDATES.indexOf("pip3.7"),
    );
    expect(PIP_CANDIDATES.at(-1)).toBe("pip");
  });

  it("contains unique names", () => {
    expect(new Set(PIP_CANDIDATES).size).toBe(PIP_CANDIDATES.length);
  });
});

describe("resolvePython / resolvePip (live probes)", () => {
  it("resolvePython either finds python or returns present=false (no crash)", () => {
    const result = resolvePython();
    if (result.present) {
      expect(result.binary).toBeTruthy();
      expect(result.version).toBeTruthy();
    } else {
      expect(result.binary).toBeUndefined();
      expect(result.version).toBeUndefined();
    }
  });

  it("resolvePip either finds pip or returns present=false (no crash)", () => {
    const result = resolvePip();
    if (result.present) {
      expect(result.binary).toBeTruthy();
      expect(result.version).toBeTruthy();
    } else {
      expect(result.binary).toBeUndefined();
      expect(result.version).toBeUndefined();
    }
  });
});