import { describe, it, expect } from "vitest";
import { buildBranchUrl, detectPlatform, parseRemote } from "./branch-url";

describe("parseRemote", () => {
  it("parses https URLs", () => {
    expect(parseRemote("https://github.com/user/repo.git")).toEqual({
      host: "github.com",
      port: null,
      path: "user/repo",
    });
  });

  it("parses https URLs with port", () => {
    expect(
      parseRemote("https://api.sc-ci.sber.ru:7998/UKPO/ukpo"),
    ).toEqual({
      host: "api.sc-ci.sber.ru",
      port: "7998",
      path: "UKPO/ukpo",
    });
  });

  it("parses ssh-protocol URLs", () => {
    expect(
      parseRemote("ssh://git@gitlab.example.com/group/repo.git"),
    ).toEqual({
      host: "gitlab.example.com",
      port: null,
      path: "group/repo",
    });
  });

  it("parses SSH-alt (git@host:path)", () => {
    expect(parseRemote("git@github.com:user/repo.git")).toEqual({
      host: "github.com",
      port: null,
      path: "user/repo",
    });
  });

  it("returns null on garbage", () => {
    expect(parseRemote("not-a-url")).toBeNull();
    expect(parseRemote("")).toBeNull();
    expect(parseRemote("   ")).toBeNull();
  });
});

describe("detectPlatform", () => {
  it("classifies GitHub", () => {
    expect(detectPlatform("https://github.com/user/repo")).toBe("github");
    expect(detectPlatform("git@github.com:user/repo.git")).toBe("github");
  });

  it("classifies GitLab.com", () => {
    expect(detectPlatform("https://gitlab.com/g/r")).toBe("gitlab");
  });

  it("classifies self-hosted GitLab by host substring", () => {
    expect(
      detectPlatform("https://gitlab.internal.example.com/g/r"),
    ).toBe("gitlab");
  });

  it("classifies Bitbucket Cloud", () => {
    expect(detectPlatform("https://bitbucket.org/u/r")).toBe(
      "bitbucket-cloud",
    );
  });

  it("classifies Sber Bitbucket DC", () => {
    expect(
      detectPlatform("https://api.sc-ci.sber.ru:7998/UKPO/ukpo"),
    ).toBe("bitbucket-dc-sber");
  });

  it("classifies Sber Bitbucket DC via SSH-alt without port", () => {
    expect(
      detectPlatform("ssh://git@api.sc-ci.sber.ru/UKPO/ukpo.git"),
    ).toBe("bitbucket-dc-sber");
  });

  it("classifies Stash by host", () => {
    expect(
      detectPlatform("ssh://git@stash.example.com:7999/PROJ/repo.git"),
    ).toBe("stash");
  });

  it("classifies unknown hosts", () => {
    expect(
      detectPlatform("https://unknown.example.com/foo/bar.git"),
    ).toBe("unknown");
  });
});

describe("buildBranchUrl", () => {
  it("builds GitHub tree URL from https", () => {
    expect(
      buildBranchUrl("https://github.com/user/repo.git", "feature/x"),
    ).toBe("https://github.com/user/repo/tree/feature/x");
  });

  it("builds GitHub tree URL from ssh-alt", () => {
    expect(
      buildBranchUrl("git@github.com:user/repo.git", "main"),
    ).toBe("https://github.com/user/repo/tree/main");
  });

  it("builds GitLab URL with -/tree/", () => {
    expect(
      buildBranchUrl("https://gitlab.com/group/repo.git", "develop"),
    ).toBe("https://gitlab.com/group/repo/-/tree/develop");
  });

  it("builds Bitbucket Cloud src URL", () => {
    expect(
      buildBranchUrl("https://bitbucket.org/u/r.git", "main"),
    ).toBe("https://bitbucket.org/u/r/src/main");
  });

  it("builds Sber Bitbucket DC branch URL (target case)", () => {
    expect(
      buildBranchUrl(
        "https://api.sc-ci.sber.ru:7998/UKPO/ukpo",
        "feature/OKECS-13080",
      ),
    ).toBe(
      "https://sc-ci.sber.ru/sc/UKPO/ukpo/src/branch/feature/OKECS-13080",
    );
  });

  it("builds Sber Bitbucket DC branch URL via ssh-protocol", () => {
    expect(
      buildBranchUrl(
        "ssh://git@api.sc-ci.sber.ru:7998/UKPO/ukpo.git",
        "feature/OKECS-13080",
      ),
    ).toBe(
      "https://sc-ci.sber.ru/sc/UKPO/ukpo/src/branch/feature/OKECS-13080",
    );
  });

  it("builds Stash browse URL", () => {
    expect(
      buildBranchUrl(
        "ssh://git@stash.example.com:7999/PROJ/repo.git",
        "feature/x",
      ),
    ).toBe(
      "https://stash.example.com/projects/PROJ/repos/repo/browse?at=refs/heads/feature/x",
    );
  });

  it("falls back to tree/<branch> for unknown hosts", () => {
    expect(
      buildBranchUrl("https://unknown.example.com/foo/bar.git", "main"),
    ).toBe("https://unknown.example.com/foo/bar/tree/main");
  });

  it("keeps `/` in branch names but escapes spaces and other special chars", () => {
    expect(
      buildBranchUrl(
        "https://github.com/user/repo.git",
        "feature/has space/x",
      ),
    ).toBe("https://github.com/user/repo/tree/feature/has%20space/x");
  });

  it("escapes `?`, `#`, `&`, `+` in branch names", () => {
    expect(
      buildBranchUrl("https://github.com/u/r.git", "feat?a#b&c+d"),
    ).toBe("https://github.com/u/r/tree/feat%3Fa%23b%26c%2Bd");
  });

  it("returns null on unparseable remote", () => {
    expect(buildBranchUrl("not-a-url", "main")).toBeNull();
  });

  it("returns null on empty branch", () => {
    expect(buildBranchUrl("https://github.com/u/r.git", "")).toBeNull();
    expect(
      buildBranchUrl("https://github.com/u/r.git", "   "),
    ).toBeNull();
  });

  it("returns null when unknown remote has no path segments", () => {
    expect(buildBranchUrl("https://example.com", "main")).toBeNull();
  });
});
