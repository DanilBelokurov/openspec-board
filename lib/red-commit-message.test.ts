import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildRedCommitMessage,
  extractRedCommitJiraKey,
} from "./red-commit-message";

describe("buildRedCommitMessage", () => {
  describe("with a Jira key", () => {
    it("prepends [<KEY>] from a full Atlassian browse URL", () => {
      expect(
        buildRedCommitMessage({
          jiraUrl: "https://company.atlassian.net/browse/OKECS-13080",
          serviceName: "article-service",
        }),
      ).toBe("[OKECS-13080] test: RED-phase tests for article-service");
    });

    it("accepts a raw Jira key passed as jiraUrl", () => {
      expect(
        buildRedCommitMessage({ jiraUrl: "ENG-42", serviceName: "svc" }),
      ).toBe("[ENG-42] test: RED-phase tests for svc");
    });

    it("ignores query string and fragment on the URL", () => {
      expect(
        buildRedCommitMessage({
          jiraUrl: "https://x.atlassian.net/browse/ENG-1?foo=bar#focus",
          serviceName: "svc",
        }),
      ).toBe("[ENG-1] test: RED-phase tests for svc");
    });

    it("handles the Sber-style browse URL", () => {
      expect(
        buildRedCommitMessage({
          jiraUrl: "https://sc-ci.sber.ru/browse/UKPO-7777",
          serviceName: "ukpo",
        }),
      ).toBe("[UKPO-7777] test: RED-phase tests for ukpo");
    });

    it("does not double-wrap brackets if the key somehow contains them", () => {
      // extractJiraId's regex won't normally allow brackets, but
      // stripBrackets is a defense-in-depth measure — verify it.
      expect(
        buildRedCommitMessage({
          jiraUrl: "https://x.atlassian.net/browse/[[ENG-9]]",
          serviceName: "svc",
        }),
      ).toBe("[ENG-9] test: RED-phase tests for svc");
    });
  });

  describe("variant: 'updated'", () => {
    it("appends (updated) when variant=updated", () => {
      expect(
        buildRedCommitMessage(
          { jiraUrl: "ENG-7", serviceName: "svc" },
          "updated",
        ),
      ).toBe("[ENG-7] test: RED-phase tests for svc (updated)");
    });

    it("default variant is 'initial' (no suffix)", () => {
      expect(
        buildRedCommitMessage({ jiraUrl: "ENG-1", serviceName: "svc" }),
      ).toBe("[ENG-1] test: RED-phase tests for svc");
    });
  });

  describe("fallback when Jira is unavailable", () => {
    it("falls back to legacy format when jiraUrl is missing", () => {
      expect(
        buildRedCommitMessage({ serviceName: "svc" }, "initial"),
      ).toBe("test: RED-phase tests for svc");
    });

    it("falls back to legacy format when jiraUrl is empty string", () => {
      expect(
        buildRedCommitMessage({ jiraUrl: "", serviceName: "svc" }),
      ).toBe("test: RED-phase tests for svc");
    });

    it("falls back to legacy format when jiraUrl is whitespace only", () => {
      expect(
        buildRedCommitMessage({ jiraUrl: "   ", serviceName: "svc" }),
      ).toBe("test: RED-phase tests for svc");
    });

    it("falls back to legacy format when extractJiraId returns null", () => {
      expect(
        buildRedCommitMessage({
          jiraUrl: "not a url or key",
          serviceName: "svc",
        }),
      ).toBe("test: RED-phase tests for svc");
    });

    it("preserves the (updated) suffix in fallback mode", () => {
      expect(
        buildRedCommitMessage({ serviceName: "svc" }, "updated"),
      ).toBe("test: RED-phase tests for svc (updated)");
    });
  });

  describe("serviceName sanitization", () => {
    it("uses 'service' literal when serviceName is missing", () => {
      expect(buildRedCommitMessage({ jiraUrl: "ENG-1" })).toBe(
        "[ENG-1] test: RED-phase tests for service",
      );
    });

    it("collapses newlines and CRLF in serviceName to spaces", () => {
      expect(
        buildRedCommitMessage({
          jiraUrl: "ENG-1",
          serviceName: "evil\nname",
        }),
      ).toBe("[ENG-1] test: RED-phase tests for evil name");
      expect(
        buildRedCommitMessage({
          jiraUrl: "ENG-1",
          serviceName: "evil\r\nname",
        }),
      ).toBe("[ENG-1] test: RED-phase tests for evil name");
    });

    it("strips NUL bytes from serviceName", () => {
      expect(
        buildRedCommitMessage({
          jiraUrl: "ENG-1",
          serviceName: "evil\x00name",
        }),
      ).toBe("[ENG-1] test: RED-phase tests for evilname");
    });

    it("trims surrounding whitespace from serviceName", () => {
      expect(
        buildRedCommitMessage({
          jiraUrl: "ENG-1",
          serviceName: "  svc  ",
        }),
      ).toBe("[ENG-1] test: RED-phase tests for svc");
    });
  });
});

describe("buildRedCommitMessage logging", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("does not warn on a successful extraction", () => {
    buildRedCommitMessage({ jiraUrl: "ENG-1", serviceName: "svc" });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when jiraUrl is missing entirely", () => {
    buildRedCommitMessage({ serviceName: "svc" });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when jiraUrl is empty/whitespace", () => {
    buildRedCommitMessage({ jiraUrl: "", serviceName: "svc" });
    buildRedCommitMessage({ jiraUrl: "   ", serviceName: "svc" });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns once when jiraUrl is present but unparseable", () => {
    buildRedCommitMessage({ jiraUrl: "garbage", serviceName: "svc" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toMatch(
      /extractJiraId returned null/,
    );
    expect(String(warnSpy.mock.calls[0][0])).toContain("garbage");
  });
});

describe("extractRedCommitJiraKey", () => {
  it("returns the key when present", () => {
    expect(
      extractRedCommitJiraKey({
        jiraUrl: "https://x.atlassian.net/browse/ENG-42",
      }),
    ).toBe("ENG-42");
  });

  it("returns null when jiraUrl is missing", () => {
    expect(extractRedCommitJiraKey({})).toBeNull();
  });

  it("returns null when extractJiraId cannot parse", () => {
    expect(extractRedCommitJiraKey({ jiraUrl: "garbage" })).toBeNull();
  });

  it("strips brackets from the returned key", () => {
    expect(
      extractRedCommitJiraKey({
        jiraUrl: "https://x.atlassian.net/browse/[[ENG-7]]",
      }),
    ).toBe("ENG-7");
  });
});
