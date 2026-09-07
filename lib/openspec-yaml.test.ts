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
  readTitleFromOpenspecYaml,
  updateStageInOpenspecYaml,
  writeOpenSpecMetadata,
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

describe("readTitleFromOpenspecYaml", () => {
  let root: string;
  let tag: string;

  beforeEach(async () => {
    ({ root, tag } = await makeChangeRoot());
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns null when the file is missing", async () => {
    expect(await readTitleFromOpenspecYaml(root, tag)).toBeNull();
  });

  it("returns null when the file has no title key", async () => {
    await fs.writeFile(
      openspecYamlPath(changeDir(root, tag)),
      'changeName: add-oauth\nstage: proposal\n',
    );
    expect(await readTitleFromOpenspecYaml(root, tag)).toBeNull();
  });

  it("reads an unquoted title value", async () => {
    await fs.writeFile(
      openspecYamlPath(changeDir(root, tag)),
      "changeName: add-oauth\ntitle: Plain ASCII heading\n",
    );
    expect(await readTitleFromOpenspecYaml(root, tag)).toBe(
      "Plain ASCII heading",
    );
  });

  it("decodes escaped quote / backslash / newline sequences from a double-quoted title", async () => {
    // Mirrors what writeOpenSpecMetadata emits for tricky input:
    // the in-memory value must survive a round-trip through disk.
    await fs.writeFile(
      openspecYamlPath(changeDir(root, tag)),
      'changeName: add-oauth\ntitle: "line one\\nline \\"two\\" with \\\\ slash"\n',
    );
    expect(await readTitleFromOpenspecYaml(root, tag)).toBe(
      'line one\nline "two" with \\ slash',
    );
  });

  it("treats a single-quoted YAML scalar as literal text (no escapes)", async () => {
    // We accept quoted-or-unquoted on read; the writer always uses
    // double quotes, so this case mainly exists to keep our parser
    // honest against hand-edited files written by other tools.
    await fs.writeFile(
      openspecYamlPath(changeDir(root, tag)),
      "changeName: add-oauth\ntitle: 'literal \\n stays literal'\n",
    );
    expect(await readTitleFromOpenspecYaml(root, tag)).toBe(
      "literal \\n stays literal",
    );
  });

  it("returns null for a present-but-empty title value", async () => {
    await fs.writeFile(
      openspecYamlPath(changeDir(root, tag)),
      'changeName: add-oauth\ntitle: ""\n',
    );
    expect(await readTitleFromOpenspecYaml(root, tag)).toBeNull();
  });
});

describe("writeOpenSpecMetadata", () => {
  let root: string;
  let tag: string;

  beforeEach(async () => {
    ({ root, tag } = await makeChangeRoot());
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("synthesises a clean two-key file when none exists yet", async () => {
    // First-time write must not leave a stray blank line between
    // `changeName:` and `stage:`/`title:` — that mismatch against
    // OpenSpec CLI output surfaces as `extra blank line` in PR reviews.
    const changed = await writeOpenSpecMetadata(root, tag, {
      stage: "proposal",
      title: "Add OAuth login",
    });
    expect(changed).toBe(true);
    const raw = await fs.readFile(
      openspecYamlPath(changeDir(root, tag)),
      "utf-8",
    );
    expect(raw).toBe(
      'changeName: add-oauth\nstage: proposal\ntitle: "Add OAuth login"\n',
    );
  });

  it("creates the .openspec.yaml even when only one key is supplied", async () => {
    const changed = await writeOpenSpecMetadata(root, tag, {
      stage: "proposal",
    });
    expect(changed).toBe(true);
    const raw = await fs.readFile(
      openspecYamlPath(changeDir(root, tag)),
      "utf-8",
    );
    expect(raw).toBe("changeName: add-oauth\nstage: proposal\n");
  });

  it("patches an existing file without rewriting sibling keys", async () => {
    await fs.writeFile(
      openspecYamlPath(changeDir(root, tag)),
      'changeName: add-oauth\nversion: "1"\nauthor: alice\n',
    );
    const changed = await writeOpenSpecMetadata(root, tag, {
      stage: "design",
      title: "OAuth redesigned",
    });
    expect(changed).toBe(true);
    const raw = await fs.readFile(
      openspecYamlPath(changeDir(root, tag)),
      "utf-8",
    );
    expect(raw).toBe(
      'changeName: add-oauth\nversion: "1"\nauthor: alice\nstage: design\ntitle: "OAuth redesigned"\n',
    );
  });

  it("preserves a manually-appended version below the changeName header", async () => {
    // Regression guard for the earlier off-by-one bug where the
    // first patch ended up *above* a hand-written header.
    await fs.writeFile(
      openspecYamlPath(changeDir(root, tag)),
      "changeName: add-oauth\n",
    );
    await writeOpenSpecMetadata(root, tag, { stage: "proposal" });
    await fs.appendFile(
      openspecYamlPath(changeDir(root, tag)),
      'version: "2"\n',
    );
    const changed = await writeOpenSpecMetadata(root, tag, {
      title: "OAuth v2",
    });
    expect(changed).toBe(true);
    const raw = await fs.readFile(
      openspecYamlPath(changeDir(root, tag)),
      "utf-8",
    );
    expect(raw).toBe(
      'changeName: add-oauth\nstage: proposal\nversion: "2"\ntitle: "OAuth v2"\n',
    );
  });

  it("is idempotent for both stage and title", async () => {
    await writeOpenSpecMetadata(root, tag, {
      stage: "proposal",
      title: "Add OAuth login",
    });
    const before = await fs.readFile(
      openspecYamlPath(changeDir(root, tag)),
      "utf-8",
    );
    const second = await writeOpenSpecMetadata(root, tag, {
      stage: "proposal",
      title: "Add OAuth login",
    });
    expect(second).toBe(false);
    const after = await fs.readFile(
      openspecYamlPath(changeDir(root, tag)),
      "utf-8",
    );
    expect(after).toBe(before);
  });

  it("replaces only the title when stage is unchanged", async () => {
    await writeOpenSpecMetadata(root, tag, {
      stage: "proposal",
      title: "Old heading",
    });
    const changed = await writeOpenSpecMetadata(root, tag, {
      title: "New heading",
    });
    expect(changed).toBe(true);
    const raw = await fs.readFile(
      openspecYamlPath(changeDir(root, tag)),
      "utf-8",
    );
    // Stage line preserved verbatim above the rewritten title line.
    expect(raw).toBe(
      'changeName: add-oauth\nstage: proposal\ntitle: "New heading"\n',
    );
  });

  it("escapes quotes, backslashes and newlines inside the title", async () => {
    const weird = 'has "quote", a \\ backslash, and a\nnewline';
    await writeOpenSpecMetadata(root, tag, {
      stage: "proposal",
      title: weird,
    });
    const raw = await fs.readFile(
      openspecYamlPath(changeDir(root, tag)),
      "utf-8",
    );
    expect(raw).toBe(
      'changeName: add-oauth\nstage: proposal\ntitle: "has \\"quote\\", a \\\\ backslash, and a\\nnewline"\n',
    );
  });

  it("round-trips a tricky title through write then read", async () => {
    const original =
      'OAuth: «Войти через» + перенос\nстроки и \\ слэш';
    await writeOpenSpecMetadata(root, tag, {
      stage: "design",
      title: original,
    });
    expect(await readTitleFromOpenspecYaml(root, tag)).toBe(original);
  });

  it("emits an empty double-quoted title when given an empty string", async () => {
    // The UI occasionally serialises an untitled task as "" —
    // we want a parseable empty slot rather than an absent key,
    // so downstream readers can distinguish "author cleared it"
    // from "the field was never published".
    await writeOpenSpecMetadata(root, tag, { title: "" });
    const raw = await fs.readFile(
      openspecYamlPath(changeDir(root, tag)),
      "utf-8",
    );
    expect(raw).toBe('changeName: add-oauth\ntitle: ""\n');
    expect(await readTitleFromOpenspecYaml(root, tag)).toBeNull();
  });
});
