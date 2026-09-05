/**
 * Tests for the .openspec.yaml stage metadata helpers
 * (readStageFromOpenspecYaml / updateStageInOpenspecYaml).
 *
 * YAML parsing is regex-based (no yaml dependency), so these tests
 * pin the exact file shapes we both read and write — the flat
 * `stage: <value>` line as emitted by `openspec new change` and by
 * the publish flow.
 *
 * The mergeRemoteFeatureScan integration (published stage beats
 * artifact-presence inference) lives in feature-branches-scanner.test.ts —
 * state.json is process-global, so the integration must not run in
 * parallel with the scanner suite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  readStageFromOpenspecYaml,
  updateStageInOpenspecYaml,
  openspecYamlPath,
} from "./openspec";

async function makeChangeRoot(): Promise<{ root: string; tag: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-yaml-"));
  const tag = "add-oauth";
  await fs.mkdir(path.join(root, "openspec", "changes", tag), {
    recursive: true,
  });
  return { root, tag };
}

function changeDir(root: string, tag: string): string {
  return path.join(root, "openspec", "changes", tag);
}

describe("readStageFromOpenspecYaml", () => {
  let root: string;
  let tag: string;

  beforeEach(async () => {
    ({ root, tag } = await makeChangeRoot());
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reads the stage from a file written by updateStageInOpenspecYaml", async () => {
    await updateStageInOpenspecYaml(root, tag, "design");
    expect(await readStageFromOpenspecYaml(root, tag)).toBe("design");
  });

  it("returns null when the file is missing", async () => {
    expect(await readStageFromOpenspecYaml(root, tag)).toBeNull();
  });

  it("returns null when the file has no stage key", async () => {
    await fs.writeFile(
      openspecYamlPath(changeDir(root, tag)),
      "changeName: add-oauth\nversion: \"1\"\n",
    );
    expect(await readStageFromOpenspecYaml(root, tag)).toBeNull();
  });

  it("returns null for an unknown stage value", async () => {
    await fs.writeFile(
      openspecYamlPath(changeDir(root, tag)),
      "changeName: add-oauth\nstage: mystery-stage\n",
    );
    expect(await readStageFromOpenspecYaml(root, tag)).toBeNull();
  });

  it("accepts a quoted stage value", async () => {
    await fs.writeFile(
      openspecYamlPath(changeDir(root, tag)),
      'changeName: add-oauth\nstage: "done"\n',
    );
    expect(await readStageFromOpenspecYaml(root, tag)).toBe("done");
  });
});

describe("updateStageInOpenspecYaml", () => {
  let root: string;
  let tag: string;

  beforeEach(async () => {
    ({ root, tag } = await makeChangeRoot());
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("creates a minimal file when none exists", async () => {
    const changed = await updateStageInOpenspecYaml(root, tag, "proposal");
    expect(changed).toBe(true);
    const raw = await fs.readFile(openspecYamlPath(changeDir(root, tag)), "utf-8");
    expect(raw).toBe("changeName: add-oauth\nstage: proposal\n");
  });

  it("replaces an existing stage key in place", async () => {
    await fs.writeFile(
      openspecYamlPath(changeDir(root, tag)),
      "changeName: add-oauth\nversion: \"1\"\nstage: proposal\n",
    );
    const changed = await updateStageInOpenspecYaml(root, tag, "adr");
    expect(changed).toBe(true);
    const raw = await fs.readFile(openspecYamlPath(changeDir(root, tag)), "utf-8");
    // Everything else preserved, only the stage line rewritten.
    expect(raw).toBe(
      "changeName: add-oauth\nversion: \"1\"\nstage: adr\n",
    );
  });

  it("appends the stage key when the file exists without one", async () => {
    await fs.writeFile(
      openspecYamlPath(changeDir(root, tag)),
      "changeName: add-oauth\n",
    );
    const changed = await updateStageInOpenspecYaml(root, tag, "delta-spec");
    expect(changed).toBe(true);
    const raw = await fs.readFile(openspecYamlPath(changeDir(root, tag)), "utf-8");
    expect(raw).toBe("changeName: add-oauth\nstage: delta-spec\n");
  });

  it("is a no-op when the stage is already current", async () => {
    await updateStageInOpenspecYaml(root, tag, "design");
    const before = await fs.readFile(openspecYamlPath(changeDir(root, tag)), "utf-8");
    const changed = await updateStageInOpenspecYaml(root, tag, "design");
    expect(changed).toBe(false);
    const after = await fs.readFile(openspecYamlPath(changeDir(root, tag)), "utf-8");
    expect(after).toBe(before);
  });
});
