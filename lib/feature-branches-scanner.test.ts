/**
 * Tests for `scanRemoteFeatureBranches` and
 * `mergeRemoteFeatureScan`.
 *
 * We run REAL git against a throwaway bare + clone repo in a temp
 * dir (via node's `fs.mkdtemp`), set up feature branches with
 * openspec/changes/*, and verify:
 *
 *   - the scanner picks up remote feature branches
 *   - JIRA-ID filtering drops scratch branches
 *   - author is read from the tip commit
 *   - tag / design / specs are derived from the tree
 *   - mergeRemoteFeatureScan creates a remote read-only task
 *   - force-push refresh updates the sourceCommit
 *   - local task with same tag is left untouched
 *
 * This is the most honest kind of test for a git wrapper — mocking
 * `git` output is brittle because the scanner's correctness hinges
 * on real output formats (for-each-ref / ls-tree / show).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fsSync from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";

// helper: run a sync git command in a dir
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });
}

// Create a bare "origin" and clone it as the working store.
async function makeRepos() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "feature-scan-"));
  const origin = path.join(root, "origin.git");
  const clone = path.join(root, "clone");

  git("", ["init", "--bare", origin]);
  git("", ["clone", origin, clone]);
  git(clone, ["config", "user.email", "alice@corp.com"]);
  git(clone, ["config", "user.name", "Alice Smith"]);
  git(clone, ["checkout", "-b", "master"]);

  return { root, origin, clone };
}

// Create an openspec change folder + commit on the given branch.
function addChange(
  clone: string,
  branch: string,
  tag: string,
  {
    specs = false,
    design = false,
    title = "Proposal title",
    yamlStage,
  }: {
    specs?: boolean;
    design?: boolean;
    title?: string;
    yamlStage?: string;
  } = {},
) {
  const changeDir = path.join(clone, "openspec", "changes", tag);
  fsSync.mkdirSync(changeDir, { recursive: true });
  const proposal = `# ${title}\n\nОписание задачи.\n`;
  fsSync.writeFileSync(path.join(changeDir, "proposal.md"), proposal);
  if (specs) {
    fsSync.mkdirSync(path.join(changeDir, "specs"), { recursive: true });
    fsSync.writeFileSync(
      path.join(changeDir, "specs", "capability.md"),
      "## ADDED Requirements\n",
    );
  }
  if (design) {
    fsSync.writeFileSync(path.join(changeDir, "design.md"), "# Design\n");
  }
  if (yamlStage) {
    fsSync.writeFileSync(
      path.join(changeDir, ".openspec.yaml"),
      `changeName: ${tag}\nstage: ${yamlStage}\n`,
    );
  }
  git(clone, ["add", "openspec/"]);
  git(clone, ["commit", "-m", `feat: ${tag}`]);
  // Create the branch only if it's not the current HEAD's branch
  // (master is checked out by makeRepos). Branching off the
  // current commit is idempotent when branch === HEAD branch.
  const head = git(clone, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (head !== branch) {
    git(clone, ["branch", branch]);
  }
}

async function cleanupDir(p: string) {
  await fs.rm(p, { recursive: true, force: true });
}

let repo: { root: string; origin: string; clone: string } | null = null;

beforeEach(async () => {
  repo = await makeRepos();
});

afterEach(async () => {
  if (repo) await cleanupDir(repo.root);
});

describe("scanRemoteFeatureBranches (integration, real git)", () => {
  it("discovers a feature branch with a proposal and author", async () => {
    const { clone } = repo!;
    // Build a change on a feature branch off master.
    addChange(clone, "feature/OKECS-13078", "add-oauth", {
      specs: true,
      design: true,
    });
    // Push origin
    git(clone, ["push", "-u", "origin", "feature/OKECS-13078"]);

    // Fresh clone state has no feature refs yet; the scanner
    // runs `git fetch origin --prune` to pull them.
    const { scanRemoteFeatureBranches } = await import(
      "./feature-branches-scanner"
    );
    const result = await scanRemoteFeatureBranches(clone);

    expect(result).toHaveLength(1);
    const p = result[0];
    expect(p.remoteRef).toBe("origin/feature/OKECS-13078");
    expect(p.jiraId).toBe("OKECS-13078");
    expect(p.publishedBy.email).toBe("alice@corp.com");
    expect(p.publishedBy.name).toBe("Alice Smith");
    expect(p.tag).toBe("add-oauth");
    expect(p.hasProposal).toBe(true);
    expect(p.hasDesign).toBe(true);
    expect(p.hasSpecs).toBe(true);
    expect(p.proposalTitle).toBe("Proposal title");
  });

  it("ignores non-JIRA feature branches (WIP, digits-only)", async () => {
    const { clone } = repo!;
    // Build a valid branch AND an invalid one.
    addChange(clone, "feature/OKECS-13078", "add-oauth");
    addChange(clone, "feature/WIP", "wip-thing");
    git(clone, ["push", "-u", "origin", "feature/OKECS-13078"]);
    git(clone, ["push", "-u", "origin", "feature/WIP"]);

    const { scanRemoteFeatureBranches } = await import(
      "./feature-branches-scanner"
    );
    const result = await scanRemoteFeatureBranches(clone);

    expect(result).toHaveLength(1);
    expect(result[0].remoteRef).toBe("origin/feature/OKECS-13078");
  });

  it("drops branches whose tree has no proposal.md", async () => {
    const { clone } = repo!;
    // Branch with NO proposal.md at all.
    const changeDir = path.join(
      clone,
      "openspec",
      "changes",
      "no-proposal-tag",
    );
    fsSync.mkdirSync(changeDir, { recursive: true });
    fsSync.writeFileSync(path.join(changeDir, "design.md"), "# Design\n");
    git(clone, ["add", "openspec/"]);
    git(clone, ["commit", "-m", "feat: no-proposal"]);
    git(clone, ["branch", "feature/ENG-42"]);
    git(clone, ["push", "-u", "origin", "feature/ENG-42"]);

    const { scanRemoteFeatureBranches } = await import(
      "./feature-branches-scanner"
    );
    const result = await scanRemoteFeatureBranches(clone);
    expect(result).toHaveLength(0);
  });
});

describe("mergeRemoteFeatureScan (integration, real git + state.json)", () => {
  it("creates a remote read-only task in state.json", async () => {
    const { clone } = repo!;
    addChange(clone, "feature/OKECS-13078", "add-oauth");
    git(clone, ["push", "-u", "origin", "feature/OKECS-13078"]);

    const { mergeRemoteFeatureScan } = await import("./state");
    // Need an openspecDir that is the git repo clone.
    const result = await mergeRemoteFeatureScan(clone);
    expect(result.discovered).toBe(1);

    const state = await readStateFile();
    const task = state.tasks["analyst:add-oauth"];
    expect(task).toBeDefined();
    expect(task.remote).toBe(true);
    expect(task.publishedBy.email).toBe("alice@corp.com");
    expect(task.remoteBranch).toBe("origin/feature/OKECS-13078");
    expect(task.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(task.stage).toBe("proposal");
    // A read-only mirror worktree is materialized on discovery.
    expect(task.openspecWorktreePath).toBeDefined();
    expect(task.openspecWorktreePath).toContain(".remote-worktrees");
  });

  it("refreshes sourceCommit and author on force-push", async () => {
    const { clone } = repo!;
    addChange(clone, "feature/OKECS-13078", "add-oauth");
    git(clone, ["push", "-u", "origin", "feature/OKECS-13078"]);

    const { mergeRemoteFeatureScan } = await import("./state");
    await mergeRemoteFeatureScan(clone);
    const before = (await readStateFile()).tasks["analyst:add-oauth"];
    const shaBefore = before!.sourceCommit;

    // Amend the tip + force-push, then re-scan. Must be on the
    // feature branch (addChange leaves HEAD on master).
    git(clone, ["checkout", "feature/OKECS-13078"]);
    fsSync.writeFileSync(
      path.join(clone, "openspec", "changes", "add-oauth", "proposal.md"),
      "# Updated title\n\nНовое описание.\n",
    );
    git(clone, ["add", "openspec/"]);
    git(clone, ["commit", "--amend", "-m", "feat: add-oauth (updated)"]);
    git(clone, ["push", "-f", "-u", "origin", "feature/OKECS-13078"]);

    const result = await mergeRemoteFeatureScan(clone);
    expect(result.updated).toBe(1);

    const after = (await readStateFile()).tasks["analyst:add-oauth"];
    expect(after!.sourceCommit).not.toBe(shaBefore);
    expect(after!.summary.title).toBe("Updated title");
  });

  it("leaves a local task with the same tag untouched", async () => {
    const { clone } = repo!;
    // Create the change under a tag, commit on master, but do NOT
    // push the feature branch to origin. Instead make a local
    // analyst task in state.json that "claims" this tag.
    addChange(clone, "master", "add-oauth");

    const { mergeRemoteFeatureScan } = await import("./state");
    const { readState, writeState, taskKey } = await import("./state");
    // Seed a local task.
    const seed = await readState();
    const now = new Date().toISOString();
    seed.tasks[taskKey("analyst", "add-oauth")] = {
      id: "local-id",
      mode: "analyst",
      stage: "design",
      lastScannedAt: now,
      summary: {
        id: "local-id",
        changeName: "add-oauth",
        path: "",
        title: "Local title",
        stage: "design",
        hasProposal: true,
        hasDesign: true,
        hasSpecs: false,
        capabilityTags: [],
        newCapabilities: [],
        modifiedCapabilities: [],
        specCounts: {
          added: 0,
          modified: 0,
          removed: 0,
          scenarios: 0,
        },
        updatedAt: now,
        fileCount: 0,
        totalSize: 0,
      },
      description: "Local description",
    };
    await writeState(seed);

    // The remote scan will find NO feature branch (nothing was
    // pushed), so mergeRemoteFeatureScan should neither create
    // nor update the existing task.
    const result = await mergeRemoteFeatureScan(clone);
    expect(result.discovered).toBe(0);
    expect(result.updated).toBe(0);

    const state = await readState();
    const task = state.tasks[taskKey("analyst", "add-oauth")];
    // Local fields survive untouched.
    expect(task!.id).toBe("local-id");
    expect(task!.remote).toBeUndefined();
    expect(task!.stage).toBe("design");
  });

  it("prefers the published .openspec.yaml stage over artifact inference", async () => {
    const { clone } = repo!;
    // design.md present — inference would say "design" — but the
    // author published stage: proposal in the metadata file. Ground
    // truth wins.
    addChange(clone, "feature/OKECS-13078", "add-oauth", {
      design: true,
      yamlStage: "proposal",
    });
    git(clone, ["push", "-u", "origin", "feature/OKECS-13078"]);

    const { mergeRemoteFeatureScan } = await import("./state");
    await mergeRemoteFeatureScan(clone);

    const state = await readStateFile();
    const task = state.tasks["analyst:add-oauth"];
    expect(task).toBeDefined();
    expect(task.stage).toBe("proposal");
    expect(task.summary.stage).toBe("proposal");
  });

  it("re-reads the published stage from .openspec.yaml after a force-push", async () => {
    const { clone } = repo!;
    addChange(clone, "feature/OKECS-13078", "add-oauth");
    git(clone, ["push", "-u", "origin", "feature/OKECS-13078"]);

    const { mergeRemoteFeatureScan } = await import("./state");
    await mergeRemoteFeatureScan(clone);

    // Author advances the change to delta-spec and amends.
    git(clone, ["checkout", "feature/OKECS-13078"]);
    const dir = path.join(clone, "openspec", "changes", "add-oauth");
    fsSync.mkdirSync(path.join(dir, "specs"), { recursive: true });
    fsSync.writeFileSync(
      path.join(dir, "specs", "cap.md"),
      "## ADDED Requirements\n",
    );
    fsSync.writeFileSync(
      path.join(dir, ".openspec.yaml"),
      "changeName: add-oauth\nstage: delta-spec\n",
    );
    git(clone, ["add", "openspec/"]);
    git(clone, ["commit", "--amend", "-m", "feat: add-oauth (delta)"]);
    git(clone, ["push", "-f", "-u", "origin", "feature/OKECS-13078"]);

    const result = await mergeRemoteFeatureScan(clone);
    expect(result.updated).toBe(1);

    const state = await readStateFile();
    const task = state.tasks["analyst:add-oauth"];
    expect(task.stage).toBe("delta-spec");
  });
});

// The merge functions read/write `.sdd-board/state.json` relative
// to process.cwd(). For tests, point that at a temp dir by
// changing our own cwd is messy (other code imports absolute
// PATHS). Instead we read the file directly from the default
// location — which in CI is the repo root `.sdd-board/`. To avoid
// polluting the real board state, we stub the write target via
// env before importing state. But lib/state.ts hardcodes the
// path; simplest is to make the integration tests read the file
// at the known location and have beforeEach back it up / restore.
// We do that below with a simple backup.

const STATE_PATH = path.join(process.cwd(), ".sdd-board", "state.json");
let originalState: string | null = null;

async function backupState() {
  try {
    originalState = await fs.readFile(STATE_PATH, "utf-8");
  } catch {
    originalState = null;
  }
}

async function restoreState() {
  if (originalState === null) {
    try {
      await fs.unlink(STATE_PATH);
    } catch {
      /* noop */
    }
  } else {
    await fs.writeFile(STATE_PATH, originalState);
  }
}

async function readStateFile() {
  const raw = await fs.readFile(STATE_PATH, "utf-8");
  return JSON.parse(raw);
}

beforeEach(async () => {
  await backupState();
});

afterEach(async () => {
  await restoreState();
});