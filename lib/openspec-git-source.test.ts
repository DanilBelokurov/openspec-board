/**
 * Tests for the git-backed artifact readers added for remote tasks
 * (`resolveArtifactSource`, `listGitChangeTree`,
 * `checkProposalExistsFromGit`, `isStageReadyFromGit`,
 * `readChangeFromGit`).
 *
 * Remote tasks (published by another user) have no local worktree:
 * their files exist only on the branch in git, not on disk. These
 * readers pull the same content out of `git ls-tree` / `git show` so
 * the board and detail page render those tasks without a checkout.
 *
 * We run REAL git against a throwaway repo in a temp dir, mirroring
 * the established approach in feature-branches-scanner.test.ts —
 * mocking `git` output is brittle because range consistency is what
 * these helpers actually depend on (ls-tree --long format, path
 * matching, etc.).
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-git-"));
  const origin = path.join(root, "origin.git");
  const clone = path.join(root, "clone");
  git("", ["init", "--bare", origin]);
  git("", ["clone", origin, clone]);
  git(clone, ["config", "user.email", "alice@corp.com"]);
  git(clone, ["config", "user.name", "Alice Smith"]);
  git(clone, ["checkout", "-b", "master"]);
  // Seed commit so HEAD always resolves to a valid ref (the
  // "absent change" tests reference this tip, which has no
  // openspec/changes/ tree).
  fsSync.writeFileSync(path.join(clone, ".gitkeep"), "");
  git(clone, ["add", "-A"]);
  git(clone, ["commit", "-m", "init"]);
  return { root, clone };
}

// Write a full change folder into the working tree and commit on
// the current branch. Returns the commit SHA (a valid `ref` for the
// git readers).
function addChangeAndCommit(clone: string, tag: string) {
  const changeDir = path.join(clone, "openspec", "changes", tag);
  fsSync.mkdirSync(path.join(changeDir, "specs", "credit-scoring"), {
    recursive: true,
  });
  fsSync.writeFileSync(
    path.join(changeDir, "proposal.md"),
    `# Proposal ${tag}\n\nОписание.\n\n## Capabilities\n\n### New Capabilities\n- \`new-thing\`\n`,
  );
  fsSync.writeFileSync(
    path.join(changeDir, "design.md"),
    "# Design\n\n## Decisions\n\n### 1. Pick X\nUse X.\n",
  );
  fsSync.writeFileSync(
    path.join(changeDir, "specs", "credit-scoring", "spec.md"),
    "# Spec\n\n## ADDED Requirements\n\n### Requirement: R1\n#### Scenario: happy\n- **WHEN** x\n- **THEN** y\n",
  );
  // A dotfile that the on-disk tree walk skips; the git reader must
  // skip it too.
  fsSync.writeFileSync(path.join(changeDir, ".hidden.md"), "secret\n");

  git(clone, ["add", "openspec/"]);
  git(clone, ["commit", "-m", `feat: ${tag}`]);
  return git(clone, ["rev-parse", "HEAD"]).trim();
}

async function cleanupDir(p: string) {
  await fs.rm(p, { recursive: true, force: true });
}

let repo: { root: string; clone: string } | null = null;

beforeEach(async () => {
  repo = await makeRepo();
});

afterEach(async () => {
  if (repo) await cleanupDir(repo.root);
});

describe("resolveArtifactSource", () => {
  it("resolves a remote task to a git source at sourceCommit", async () => {
    const { resolveArtifactSource } = await import("./openspec");
    const source = await resolveArtifactSource(
      {
        remote: true,
        sourceCommit: "abc123",
        summary: { changeName: "add-oauth" },
      },
      "/tmp/openspec-dir",
    );
    expect(source.kind).toBe("git");
    if (source.kind === "git") {
      expect(source.ref).toBe("abc123");
      expect(source.changeName).toBe("add-oauth");
      expect(source.repoDir).toBe("/tmp/openspec-dir");
    }
  });

  it("resolves a local task to a filesystem source", async () => {
    const { resolveArtifactSource } = await import("./openspec");
    const source = await resolveArtifactSource(
      {
        // Not remote — reads from the on-disk worktree path.
        openspecWorktreePath: "/tmp/my-worktree",
        summary: { changeName: "add-oauth" },
      },
      "/tmp/openspec-dir",
    );
    expect(source.kind).toBe("fs");
    if (source.kind === "fs") expect(source.root).toBe("/tmp/my-worktree");
  });
});

describe("listGitChangeTree", () => {
  it("builds the change tree from git (files, dirs, sizes, dotfiles)", async () => {
    const { clone } = repo!;
    const ref = addChangeAndCommit(clone, "add-oauth");

    const { listGitChangeTree } = await import("./openspec");
    const tree = await listGitChangeTree(clone, ref, "add-oauth");

    expect(tree).not.toBeNull();
    expect(tree!.type).toBe("directory");
    expect(tree!.name).toBe("add-oauth");

    // proposal.md, design.md, specs/ → 3 top-level entries.
    const top = tree!.children!;
    expect(top.map((n) => n.name)).toEqual(
      expect.arrayContaining(["proposal.md", "design.md", "specs"]),
    );
    // Dotfiles are skipped.
    expect(top.some((n) => n.name.startsWith("."))).toBe(false);

    const proposal = top.find((n) => n.name === "proposal.md");
    expect(proposal!.type).toBe("file");
    expect(proposal!.size).toBeGreaterThan(0);
    expect(proposal!.absolutePath).toBe("");

    const specs = top.find((n) => n.name === "specs");
    expect(specs!.type).toBe("directory");
    expect(specs!.children![0].name).toBe("credit-scoring");
    // Directory size is the sum of its file sizes.
    expect(specs!.size).toBeGreaterThan(0);
  });

  it("returns null when the change folder does not exist at the ref", async () => {
    const { clone } = repo!;
    const ref = git(clone, ["rev-parse", "HEAD"]).trim(); // empty repo tip

    const { listGitChangeTree } = await import("./openspec");
    const tree = await listGitChangeTree(clone, ref, "no-such-tag");
    expect(tree).toBeNull();
  });
});

describe("checkProposalExistsFromGit / isStageReadyFromGit", () => {
  it("detects proposal/design/specs presence from the tree", async () => {
    const { clone } = repo!;
    const ref = addChangeAndCommit(clone, "add-oauth");

    const {
      checkProposalExistsFromGit,
      isStageReadyFromGit,
    } = await import("./openspec");

    await expect(
      checkProposalExistsFromGit(clone, ref, "add-oauth"),
    ).resolves.toBe(true);
    await expect(
      isStageReadyFromGit(clone, ref, "add-oauth", "design.md"),
    ).resolves.toBe(true);
    await expect(
      isStageReadyFromGit(clone, ref, "add-oauth", "specs"),
    ).resolves.toBe(true);
    // A stage artifact that hasn't been written yet.
    await expect(
      isStageReadyFromGit(clone, ref, "add-oauth", "adr.md"),
    ).resolves.toBe(false);
  });

  it("returns false when the change folder is absent", async () => {
    const { clone } = repo!;
    const ref = git(clone, ["rev-parse", "HEAD"]).trim();

    const {
      checkProposalExistsFromGit,
      isStageReadyFromGit,
    } = await import("./openspec");

    await expect(
      checkProposalExistsFromGit(clone, ref, "no-such-tag"),
    ).resolves.toBe(false);
    await expect(
      isStageReadyFromGit(clone, ref, "no-such-tag", "design.md"),
    ).resolves.toBe(false);
  });
});

describe("readChangeFromGit", () => {
  it("returns full Change content for a remote task", async () => {
    const { clone } = repo!;
    const ref = addChangeAndCommit(clone, "add-oauth");

    const { readChangeFromGit } = await import("./openspec");
    const change = await readChangeFromGit(clone, ref, "add-oauth");

    expect(change.hasProposal).toBe(true);
    expect(change.hasDesign).toBe(true);
    expect(change.hasSpecs).toBe(true);
    expect(change.proposal).not.toBeNull();
    expect(change.proposal!.title).toBe("Proposal add-oauth");
    expect(change.design).not.toBeNull();
    expect(change.specs).toHaveLength(1);
    expect(change.specs[0].capability).toBe("credit-scoring");
    expect(change.specs[0].addedRequirements).toHaveLength(1);
    // Dotfiles don't count toward the summary, matching the tree.
    expect(change.fileCount).toBe(3); // proposal.md + design.md + specs/*/spec.md
  });
});