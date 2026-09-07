/**
 * Tests for the title-resolution chain inside `scanOneRoot`
 * (lib/openspec.ts → readChangeSummaryFromPath).
 *
 * Background: a card's summary.title can come from three places:
 *   1. `.openspec.yaml` `title:` — pre-seeded by /api/changes and
 *      rewritten by every publish-stage commit. Authoritative.
 *   2. First `# Heading` of `proposal.md`. Stand-in for legacy
 *      hand-crafted changes that pre-date our hook.
 *   3. kebab-cased change-name prettified via `kebabToTitle`.
 *      Pure fallback when neither signal exists.
 *
 * The order matters because `refreshAnalystTaskSummary` overwrites
 * state.json on every watcher tick, so the wrong priority silently
 * rolls back whatever the analyst typed into the create dialog.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { scanOneRoot } from "./openspec";

async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-scan-"));
  await fs.mkdir(path.join(root, "openspec", "changes"), { recursive: true });
  return root;
}

async function makeChange(
  repoRoot: string,
  tag: string,
  opts: {
    proposalHeading?: string;
    yamlTitle?: string;
  },
): Promise<void> {
  const dir = path.join(repoRoot, "openspec", "changes", tag);
  await fs.mkdir(dir, { recursive: true });
  if (opts.proposalHeading !== undefined) {
    await fs.writeFile(
      path.join(dir, "proposal.md"),
      `# ${opts.proposalHeading}\n\nОписание из markdown.\n`,
    );
  }
  if (opts.yamlTitle !== undefined) {
    // Always double-quoted — mirror exactly what escapeYamlString does in
    // production so the round-trip test exercises the same on-disk shape
    // that writeOpenSpecMetadata emits. Skipping any of these three steps
    // would inject an un-escaped byte into the quoted scalar and let the
    // parser terminate the string early.
    const safe = opts.yamlTitle
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, "\\n");
    await fs.writeFile(
      path.join(dir, ".openspec.yaml"),
      `changeName: ${tag}\ntitle: "${safe}"\n`,
    );
  }
}

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await makeRepo();
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe("scanOneRoot title resolution", () => {
  it("prefers yaml-title over proposal.md heading", async () => {
    await makeChange(repoRoot, "add-oauth", {
      proposalHeading: "Markdown heading",
      yamlTitle: "User-authored title from .openspec.yaml",
    });
    const [summary] = await scanOneRoot(repoRoot);
    expect(summary).toBeDefined();
    expect(summary.title).toBe("User-authored title from .openspec.yaml");
  });

  it("falls back to proposal.md heading when no yaml-title is published", async () => {
    await makeChange(repoRoot, "add-oauth", {
      proposalHeading: "Legacy markdown heading",
      // yamlTitle intentionally omitted
    });
    const [summary] = await scanOneRoot(repoRoot);
    expect(summary).toBeDefined();
    expect(summary.title).toBe("Legacy markdown heading");
  });

  it("decodes escaped quotes/backslashes/newlines from a published yaml-title", async () => {
    // Round-trip: write the file through fs as our writer would,
    // confirm scanOneRoot returns the un-escaped form.
    await makeChange(repoRoot, "atm-metrics-control-surface", {
      proposalHeading: "Ignored default heading",
      yamlTitle: 'ATM metrics: «контроль» + \\ перенос\nстроки',
    });
    const [summary] = await scanOneRoot(repoRoot);
    expect(summary).toBeDefined();
    expect(summary.title).toBe(
      'ATM metrics: «контроль» + \\ перенос\nстроки',
    );
  });

  it("falls back to kebabToTitle(changeName) when neither signal exists", async () => {
    await fs.mkdir(path.join(repoRoot, "openspec", "changes", "wire-up-billing"), {
      recursive: true,
    });
    const [summary] = await scanOneRoot(repoRoot);
    expect(summary).toBeDefined();
    expect(summary.title).toBe("Wire Up Billing");
  });

  it("does not let an empty (but present) yaml-title regress to proposal.md", async () => {
    // A blank title in yaml should fall through to proposal.md
    // rather than locking the card to an empty headline. Same
    // precedence rule the remote-feature-scanner applies.
    const dir = path.join(repoRoot, "openspec", "changes", "add-oauth");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "proposal.md"),
      "# Real heading\n\nОписание.\n",
    );
    await fs.writeFile(
      path.join(dir, ".openspec.yaml"),
      'changeName: add-oauth\ntitle: ""\n',
    );
    const [summary] = await scanOneRoot(repoRoot);
    expect(summary).toBeDefined();
    expect(summary.title).toBe("Real heading");
  });
});
