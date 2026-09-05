/**
 * Integration tests for takeOverRemoteWorktree — the git side of the
 * «Взять в работу» action (state updates live in the route handler).
 *
 * Real git against a throwaway repo in a temp dir, mirroring the
 * established approach in remote-worktree.test.ts and
 * feature-branches-scanner.test.ts: mocking git output is brittle
 * because these helpers depend on actual ref/worktree state.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fsSync from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  takeOverRemoteWorktree,
  TakeOverError,
  ensureRemoteReadonlyWorktree,
  localWorktreePath,
} from "./remote-worktree";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

async function makeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "take-over-"));
  const origin = path.join(root, "origin.git");
  const author = path.join(root, "author");
  git("", ["init", "--bare", origin]);
  git("", ["clone", origin, author]);
  git(author, ["config", "user.email", "alice@corp.com"]);
  git(author, ["config", "user.name", "Alice Smith"]);
  git(author, ["checkout", "-b", "master"]);
  fsSync.writeFileSync(path.join(author, ".gitkeep"), "");
  git(author, ["add", "-A"]);
  git(author, ["commit", "-m", "init"]);
  git(author, ["push", "-u", "origin", "master"]);
  return { root, origin, author };
}

/** Author publishes a change on feature/<feature> and pushes it. */
function pushFeatureChange(
  author: string,
  feature: string,
  fileContent: string,
): string {
  git(author, ["checkout", "-B", `feature/${feature}`]);
  const changeDir = path.join(author, "openspec", "changes", `chg-${feature}`);
  fsSync.mkdirSync(changeDir, { recursive: true });
  fsSync.writeFileSync(
    path.join(changeDir, "proposal.md"),
    `# Proposal ${feature}\n`,
  );
  fsSync.writeFileSync(path.join(author, "artifact.txt"), fileContent);
  git(author, ["add", "-A"]);
  git(author, ["commit", "-m", `feat: ${feature}`]);
  git(author, ["push", "-u", "origin", `feature/${feature}`]);
  return git(author, ["rev-parse", "HEAD"]).trim();
}

describe("takeOverRemoteWorktree", () => {
  let root: string;
  let author: string;
  let openspecDir: string;

  beforeEach(async () => {
    const tmp = await makeRepo();
    root = tmp.root;
    author = tmp.author;
    openspecDir = path.join(root, "openspec-store");
    git("", ["clone", tmp.origin, openspecDir]);
    git(openspecDir, ["config", "user.email", "bob@corp.com"]);
    git(openspecDir, ["config", "user.name", "Bob Jones"]);
  });

  afterEach(async () => {
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("creates the branch and an editable worktree, and removes the mirror", async () => {
    const remoteRef = "origin/feature/take-1";
    pushFeatureChange(author, "take-1", "v1");
    git(openspecDir, ["fetch", "origin", "feature/take-1"]);

    // Simulate the scan having materialized the read-only mirror.
    await ensureRemoteReadonlyWorktree(openspecDir, remoteRef);

    const result = await takeOverRemoteWorktree(openspecDir, remoteRef);

    expect(result.adoptedExisting).toBe(false);
    expect(result.branch).toBe("feature/take-1");
    expect(result.worktreePath).toBe(
      localWorktreePath(openspecDir, "feature/take-1"),
    );
    expect(result.worktreePath).toContain(".worktrees");

    // Editable, not detached: HEAD is on a named local branch.
    expect(
      git(result.worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    ).toBe("feature/take-1");

    // Files are present and readable.
    expect(
      fsSync.readFileSync(path.join(result.worktreePath, "artifact.txt"), "utf8"),
    ).toBe("v1");

    // The detached mirror is gone.
    const { remoteWorktreeExists } = await import("./remote-worktree");
    expect(await remoteWorktreeExists(openspecDir, remoteRef)).toBe(false);
  });

  it("never resets an existing local branch (keeps local commits)", async () => {
    const remoteRef = "origin/feature/take-2";
    pushFeatureChange(author, "take-2", "v1");
    git(openspecDir, ["fetch", "origin", "feature/take-2"]);

    // Local branch at the remote tip, plus one local commit on top.
    git(openspecDir, [
      "branch",
      "feature/take-2",
      "refs/remotes/origin/feature/take-2",
    ]);
    const scratch = path.join(root, "scratch-wt");
    git(openspecDir, ["worktree", "add", scratch, "feature/take-2"]);
    fsSync.writeFileSync(path.join(scratch, "local.txt"), "local work");
    git(scratch, ["add", "-A"]);
    git(scratch, ["commit", "-m", "local: my own edit"]);
    git(openspecDir, ["worktree", "remove", scratch]);
    const localSha = git(openspecDir, [
      "rev-parse",
      "refs/heads/feature/take-2",
    ]).trim();

    // Author force-pushes a DIFFERENT tip afterwards — the take-over
    // must follow the local branch, not the remote tip.
    git(author, ["checkout", "feature/take-2"]);
    fsSync.writeFileSync(path.join(author, "artifact.txt"), "rewritten");
    git(author, ["add", "-A"]);
    git(author, ["commit", "--amend", "--no-edit"]);
    git(author, ["push", "-f", "origin", "feature/take-2"]);

    const result = await takeOverRemoteWorktree(openspecDir, remoteRef);

    expect(
      git(result.worktreePath, ["rev-parse", "HEAD"]).trim(),
    ).toBe(localSha);
    expect(
      fsSync.readFileSync(
        path.join(result.worktreePath, "local.txt"),
        "utf8",
      ),
    ).toBe("local work");
  });

  it("adopts an existing registered worktree on the same branch", async () => {
    const remoteRef = "origin/feature/take-3";
    pushFeatureChange(author, "take-3", "v1");
    git(openspecDir, ["fetch", "origin", "feature/take-3"]);
    git(openspecDir, [
      "branch",
      "feature/take-3",
      "refs/remotes/origin/feature/take-3",
    ]);
    const stdPath = localWorktreePath(openspecDir, "feature/take-3");
    git(openspecDir, ["worktree", "add", stdPath, "feature/take-3"]);

    // A stale mirror exists too — adoption must still clean it up.
    await ensureRemoteReadonlyWorktree(openspecDir, remoteRef);

    const result = await takeOverRemoteWorktree(openspecDir, remoteRef);

    expect(result.adoptedExisting).toBe(true);
    expect(result.worktreePath).toBe(stdPath);
  });

  it("refuses when the branch is checked out in another worktree", async () => {
    const remoteRef = "origin/feature/take-4";
    pushFeatureChange(author, "take-4", "v1");
    git(openspecDir, ["fetch", "origin", "feature/take-4"]);
    git(openspecDir, [
      "branch",
      "feature/take-4",
      "refs/remotes/origin/feature/take-4",
    ]);
    git(openspecDir, [
      "worktree",
      "add",
      path.join(root, "elsewhere"),
      "feature/take-4",
    ]);

    await expect(
      takeOverRemoteWorktree(openspecDir, remoteRef),
    ).rejects.toThrow(TakeOverError);
    await expect(
      takeOverRemoteWorktree(openspecDir, remoteRef),
    ).rejects.toThrow("уже используется");
  });

  it("refuses when the remote branch no longer exists", async () => {
    await expect(
      takeOverRemoteWorktree(openspecDir, "origin/feature/ghost"),
    ).rejects.toThrow(TakeOverError);
    await expect(
      takeOverRemoteWorktree(openspecDir, "origin/feature/ghost"),
    ).rejects.toThrow("не найдена в remote");
  });

  it("refuses when the standard path holds a foreign directory", async () => {
    const remoteRef = "origin/feature/take-5";
    pushFeatureChange(author, "take-5", "v1");
    const stdPath = localWorktreePath(openspecDir, "feature/take-5");
    fsSync.mkdirSync(stdPath, { recursive: true });
    fsSync.writeFileSync(path.join(stdPath, "junk.txt"), "not a worktree");

    await expect(
      takeOverRemoteWorktree(openspecDir, remoteRef),
    ).rejects.toThrow("Путь занят посторонней директорией");
  });

  it("refuses when the standard path is a worktree on another branch", async () => {
    const remoteRef = "origin/feature/take-6";
    pushFeatureChange(author, "take-6", "v1");
    // Register a worktree at the target path but on a different branch.
    git(author, ["push", "origin", "master"]);
    git(openspecDir, ["fetch", "origin", "master"]);
    const stdPath = localWorktreePath(openspecDir, "feature/take-6");
    git(openspecDir, [
      "worktree",
      "add",
      "-b",
      "feature/other-branch",
      stdPath,
      "refs/remotes/origin/master",
    ]);

    await expect(
      takeOverRemoteWorktree(openspecDir, remoteRef),
    ).rejects.toThrow("занят ворктреем на ветке");
  });
});
