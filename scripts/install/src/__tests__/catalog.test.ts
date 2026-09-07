import { describe, expect, it } from "vitest";
import {
  findCatalogEntryByKey,
  findCatalogEntryByRaw,
  MCP_CATALOG_ENTRIES,
} from "../catalog";

describe("MCP_CATALOG_ENTRIES", () => {
  it("contains the four canonical servers", () => {
    const keys = MCP_CATALOG_ENTRIES.map((entry) => entry.settingsKey);
    expect(keys).toEqual(
      expect.arrayContaining(["jira-mcp", "bitbucket", "sourcecontrol", "sbertrack"]),
    );
  });

  it("has unique rawValue and settingsKey pairs", () => {
    const seen = new Set<string>();
    for (const entry of MCP_CATALOG_ENTRIES) {
      const composite = `${entry.rawValue}::${entry.settingsKey}`;
      expect(seen.has(composite)).toBe(false);
      seen.add(composite);
    }
  });

  it("all permission tools are non-empty strings", () => {
    for (const entry of MCP_CATALOG_ENTRIES) {
      for (const tool of entry.permissions) {
        expect(typeof tool).toBe("string");
        expect(tool.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("findCatalogEntryByKey / findCatalogEntryByRaw", () => {
  it("finds jira by key", () => {
    expect(findCatalogEntryByKey("jira-mcp")?.rawValue).toBe("jira");
  });

  it("finds bitbucket by raw value", () => {
    expect(findCatalogEntryByRaw("bitbucket")?.settingsKey).toBe("bitbucket");
  });

  it("returns undefined for unknown entries", () => {
    expect(findCatalogEntryByKey("nope")).toBeUndefined();
    expect(findCatalogEntryByRaw("nope")).toBeUndefined();
  });
});