import { describe, it, expect } from "vitest";
import { normalizeRepoName } from "./repo-name";

describe("normalizeRepoName", () => {
  describe("already-canonical inputs are returned as-is", () => {
    it.each([
      ["my-repo"],
      ["service"],
      ["v2-api"],
      ["a1b2c3"],
      ["x"], // single-letter minimum
      ["a".repeat(40)], // length cap boundary
    ])("keeps %s unchanged", (input) => {
      const r = normalizeRepoName(input);
      expect(r).toEqual({ ok: true, name: input });
    });
  });

  describe("snake_case is converted to kebab-case", () => {
    it.each([
      ["my_repo", "my-repo"],
      ["team_back_api", "team-back-api"],
      ["v2_helper", "v2-helper"],
      ["_leading", "leading"], // leading underscore trimmed
      ["trailing_", "trailing"], // trailing underscore trimmed
      ["__double__under__", "double-under"],
    ])("%s → %s", (input, expected) => {
      expect(normalizeRepoName(input)).toEqual({ ok: true, name: expected });
    });
  });

  describe("CamelCase and PascalCase are split at case boundaries", () => {
    it.each([
      ["MyService", "my-service"],
      ["myService", "my-service"],
      // Known limitation: the splitter only fires at lc|dig → UP,
      // so "HTTPServer" stays one word after lowercasing. Real-world
      // Git repo names almost never start with an acronym like that;
      // document the behavior rather than over-engineering a heuristic.
      ["HTTPServer", "httpserver"],
      ["fooBarBaz", "foo-bar-baz"],
      ["V2Api", "v2-api"], // digit→Up also splits ([a-z0-9][A-Z])
      ["articleService", "article-service"],
    ])("%s → %s", (input, expected) => {
      expect(normalizeRepoName(input)).toEqual({ ok: true, name: expected });
    });
  });

  describe("mixed delimiters collapse to a single dash", () => {
    it.each([
      ["my.repo", "my-repo"],
      ["my..repo", "my-repo"],
      ["my/repo", "my-repo"],
      ["my\\repo", "my-repo"],
      ["my repo", "my-repo"],
      ["my___...___repo", "my-repo"],
      ["My_Service.v2", "my-service-v2"],
    ])("%s → %s", (input, expected) => {
      expect(normalizeRepoName(input)).toEqual({ ok: true, name: expected });
    });
  });

  describe("edge cases that must reject", () => {
    it("rejects an input consisting of separators only", () => {
      const r = normalizeRepoName("____");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/только разделители/i);
    });

    it("rejects names longer than 40 chars after normalization", () => {
      // 45 raw chars with no separators ⇒ exactly the same length after.
      const long = "a".repeat(45);
      const r = normalizeRepoName(long);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/длиннее 40 символов .*45/);
    });

    it("flags results that start with a digit", () => {
      // Lowercasing alone can't fix this — `123abc` stays `123abc`,
      // which fails isValidRepoName's "starts with letter" rule.
      const r = normalizeRepoName("123abc");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/начинается с цифры/);
    });

    it("returns ok=false without throwing on empty string", () => {
      // Real callers won't reach normalizer with "" (derive filters
      // that out first), but defensiveness costs nothing.
      const r = normalizeRepoName("");
      expect(r.ok).toBe(false);
    });
  });

  describe("round-trip safety with deriveRepoNameFromUrl outputs", () => {
    // These mirror the shapes derive produces in lib/repo-name.ts:
    // last path segment of a git URL, .git suffix stripped.
    it.each([
      ["my-service", "my-service"],
      ["my_service", "my-service"],
      ["Cool.Repo", "cool-repo"],
      ["ArticleService", "article-service"],
      ["v2-api-core", "v2-api-core"],
    ])("%s (typical URL tail) → %s", (input, expected) => {
      expect(normalizeRepoName(input)).toEqual({ ok: true, name: expected });
    });
  });
});
