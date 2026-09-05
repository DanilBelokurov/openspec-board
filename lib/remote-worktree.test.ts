/**
 * Tests for the remote-worktree module.
 *
 * These tests run REAL git against a throwaway repo in a temp dir,
 * mirroring the established approach in openspec-git-source.test.ts
 * and feature-branches-scanner.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fsSync from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });
}

async function makeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "remote-wt-"));
  const origin = path.join(root, "origin.git");
  const clone = path.join(root, "clone");
  git("", ["init", "--bare", origin]);
  git("", ["clone", origin, clone]);
  git(clone, ["config", "user.email", "alice@corp.com"]);
  git(clone, ["config", "user.name", "Alice Smith"]);
  git(clone, ["checkout", "-b", "master"]);
  fsSync.writeFileSync(path.join(clone, ".gitkeep"), "");
  git(clone, ["add", "-A"]);
  git(clone, ["commit", "-m", "init"]);
  return { root, clone };
}

describe("remote-worktree", () => {
  describe("parseRemoteRef", () => {
    let parseRemoteRef: (ref: string) => { branch: string; feature: string };

    beforeEach(async () => {
      const m = await import("./remote-worktree");
      parseRemoteRef = m.parseRemoteRef;
    });

    it("parses a valid feature branch ref", () => {
      const result = parseRemoteRef("origin/feature/OKECS-13078");
      expect(result.branch).toBe("feature/OKECS-13078");
      expect(result.feature).toBe("OKECS-13078");
    });

    it("parses feature branches with underscores and dots", () => {
      const result = parseRemoteRef("origin/feature/feat_1.0");
      expect(result.branch).toBe("feature/feat_1.0");
      expect(result.feature).toBe("feat_1.0");
    });

    it("throws on non-feature refs", () => {
      expect(() => parseRemoteRef("origin/main")).toThrow(
        "Недопустимый remoteRef",
      );
      expect(() => parseRemoteRef("origin/")).toThrow(
        "Недопустимый remoteRef",
      );
    });

    it("throws on empty/invalid refs", () => {
      expect(() => parseRemoteRef("")).toThrow("Недопустимый remoteRef");
    });
  });

  describe("remoteWorktreePath", () => {
    let remoteWorktreePath: (openspecDir: string, ref: string) => string;

    beforeEach(async () => {
      const m = await import("./remote-worktree");
      remoteWorktreePath = m.remoteWorktreePath;
    });

    it("returns the correct mirror path", async () => {
      const { root, clone } = await makeRepo();
      const p = remoteWorktreePath(clone, "origin/feature/OKECS-13078");
      expect(p).toContain(".remote-worktrees");
      expect(p).toContain("OKECS-13078");
      await fs.rm(root, { recursive: true, force: true });
    });
  });

  describe("ensureRemoteReadonlyWorktree", () => {
    let ensureRemoteReadonlyWorktree: (
      openspecDir: string,
      remoteRef: string,
    ) => Promise<string>;
    let remoteWorktreeExists: (
      openspecDir: string,
      remoteRef: string,
    ) => Promise<boolean>;

    let root: string;
    let origin: string;
    let openspecDir: string;
    const TEST_BRANCH = "origin/feature/test-wt";

    beforeEach(async () => {
      const m = await import("./remote-worktree");
      ensureRemoteReadonlyWorktree = m.ensureRemoteReadonlyWorktree;
      remoteWorktreeExists = m.remoteWorktreeExists;
      const tmp = await makeRepo();
      root = tmp.root;
      origin = tmp.clone;
      openspecDir = path.join(root, "openspec-store");
      git("", ["clone", origin, openspecDir]);
      git(openspecDir, ["config", "user.email", "bob@corp.com"]);
      git(openspecDir, ["config", "user.name", "Bob Jones"]);

      // Create a feature branch so parseRemoteRef doesn't throw.
      git(origin, ["checkout", "-b", "feature/test-wt"]);
      fsSync.writeFileSync(path.join(origin, "wt-file.txt"), "initial");
      git(origin, ["add", "-A"]);
      git(origin, ["commit", "-m", "feat: add wt-file"]);
      git(origin, ["push", "-u", "origin", "feature/test-wt"]);

      // The shared object store (origin) now has the ref, but
      // openspec-store needs the remote-tracking ref so `git
      // worktree add ... refs/remotes/origin/feature/test-wt`
      // resolves. Fetch it into openspec-store.
      git(openspecDir, ["fetch", "origin", "feature/test-wt"]);
    });

    afterEach(async () => {
      if (root) {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("creates a detached HEAD worktree on first call", async () => {
      git(openspecDir, ["fetch", "origin", TEST_BRANCH]);

      const p = await ensureRemoteReadonlyWorktree(openspecDir, TEST_BRANCH);

      expect(await remoteWorktreeExists(openspecDir, TEST_BRANCH)).toBe(true);
      const content = fsSync.readFileSync(path.join(p, "wt-file.txt"), "utf8");
      expect(content).toBe("initial");
    });

    it("refreshes an existing mirror on a force-push", async () => {
      git(openspecDir, ["fetch", "origin", TEST_BRANCH]);

      const p = await ensureRemoteReadonlyWorktree(openspecDir, TEST_BRANCH);

      // Force-push: amend commit on origin.
      const newFile = path.join(origin, "new-file.txt");
      fsSync.writeFileSync(newFile, "new content");
      git(origin, ["add", "-A"]);
      git(origin, ["commit", "--amend", "--no-edit"]);
      git(origin, ["push", "-f"]);

      // Read SHA after amend — the mirror should reflect this new tip.
      const sha1 = git(origin, ["rev-parse", "HEAD"]).trim();

      await ensureRemoteReadonlyWorktree(openspecDir, TEST_BRANCH);
      const sha2 = git(p, ["rev-parse", "HEAD"]).trim();
      expect(sha2).toBe(sha1);
    });

    it("returns the same path on a second call", async () => {
      git(openspecDir, ["fetch", "origin", TEST_BRANCH]);
      const p1 = await ensureRemoteReadonlyWorktree(openspecDir, TEST_BRANCH);
      const p2 = await ensureRemoteReadonlyWorktree(openspecDir, TEST_BRANCH);
      expect(p1).toBe(p2);
    });
  });

  describe("remoteWorktreeExists", () => {
    let remoteWorktreeExists: (
      openspecDir: string,
      remoteRef: string,
    ) => Promise<boolean>;

    let root: string;
    let origin: string;
    let openspecDir: string;

    beforeEach(async () => {
      const m = await import("./remote-worktree");
      remoteWorktreeExists = m.remoteWorktreeExists;
      const tmp = await makeRepo();
      root = tmp.root;
      origin = tmp.clone;
      openspecDir = path.join(root, "openspec-store");
      git("", ["clone", origin, openspecDir]);
    });

    afterEach(async () => {
      if (root) {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("returns false when no mirror exists", async () => {
      const exists = await remoteWorktreeExists(
        openspecDir,
        "origin/feature/test-exists",
      );
      expect(exists).toBe(false);
    });
  });
});
