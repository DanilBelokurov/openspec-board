import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { extractJiraId } from "./jira";
import { repoBasename } from "./path-utils";
import { atomicWriteFile } from "./atomic-write";

// ============================================================================
// Types
// ============================================================================

export type Stage =
  | "backlog"
  | "decomposition"
  | "plan"
  | "develop"
  | "deploy"
  | "done"
  | "proposal"
  | "delta-spec"
  | "design"
  | "adr";

export interface Scenario {
  name: string;
  when: string[];
  then: string[];
}

export interface Requirement {
  name: string;
  body: string;
  scenarios: Scenario[];
}

export interface DeltaSpec {
  capability: string;
  purpose: string | null;
  raw: string;
  addedRequirements: Requirement[];
  modifiedRequirements: Requirement[];
  removedRequirements: Requirement[];
}

export interface Proposal {
  changeName: string;
  title: string;
  raw: string;
  motivation: string | undefined;
  scope: string | undefined;
  sections: { heading: string; body: string }[];
  newCapabilities: string[];
  modifiedCapabilities: string[];
}

export interface Design {
  raw: string;
  title: string | undefined;
  sections: { heading: string; body: string }[];
  decisions: string[];
  tradeoffs: string[];
}

export interface SpecCounts {
  added: number;
  modified: number;
  removed: number;
  scenarios: number;
}

export interface ChangeSummary {
  id: string;
  changeName: string;
  path: string;
  title: string;
  stage: Stage;
  hasProposal: boolean;
  hasDesign: boolean;
  hasSpecs: boolean;
  capabilityTags: string[];
  specCounts: SpecCounts;
  newCapabilities: string[];
  modifiedCapabilities: string[];
  updatedAt: string;
  fileCount: number;
  totalSize: number;
}

export interface Change extends ChangeSummary {
  proposal: Proposal | null;
  design: Design | null;
  specs: DeltaSpec[];
}

// What we render on the board: scan result + optional state fields
export interface BoardItem extends ChangeSummary {
  jiraUrl?: string;
  jiraId?: string;
  codeRepoPath?: string;
  // For child develop tasks: the parent's change-tag. Lets the
  // board show "↑ от <parentTag>" on the card and the detail
  // page show a "← К плану" link, so the dev sees the parent
  // relationship at a glance (child borrows the parent's
  // change-proposal, not its own).
  parentTag?: string;
  // Step 1 (analyst mode): `openspec new change` — creates the change folder.
  openspecNewStatus?: "running" | "stopped" | "none";
  // Step 2 (analyst mode): gigacode /opsx-continue — writes proposal.md.
  gigacodeContinueStatus?: "running" | "stopped" | "none";
  // delta-spec step: gigacode writes specs/<capability>.md.
  deltaSpecCreateStatus?: "running" | "stopped" | "none";
  // design step: gigacode writes design.md.
  designCreateStatus?: "running" | "stopped" | "none";
  // adr step: gigacode writes docs/adr/<id>.md.
  adrCreateStatus?: "running" | "stopped" | "none";
  // Developer-mode "Start" step: gigacode /opsx:plan.
  gigacodeStatus?: "running" | "stopped" | "none";
  proposalReady?: boolean;
  // delta-spec artifact readiness — non-empty specs/ dir under
  // <worktree>/openspec/changes/<tag>/specs/.
  deltaSpecReady?: boolean;
  // design artifact readiness — design.md exists under
  // <worktree>/openspec/changes/<tag>/.
  designReady?: boolean;
  // adr artifact readiness — adr.md exists at change folder root.
  adrReady?: boolean;
  gigacodeError?: boolean;
  // delta-spec create step error (separate from gigacodeContinueError
  // which belongs to the proposal stage).
  deltaSpecCreateError?: boolean;
  // design create step error.
  designCreateError?: boolean;
  // adr create step error.
  adrCreateError?: boolean;
  // Developer-mode archived flag. Set when the corresponding
  // change-proposal has been moved to openspec/changes/archive/
  // upstream; rendered as a red 'архив' badge on the card.
  archived?: boolean;
  // The commit SHA on the tracked branch where the change lives.
  // Surfaced in the detail-page header so the dev can jump
  // straight to the merged commit on GitHub.
  codeBaseSha?: string;
  // Pipeline status badge for the task's current stage. Computed
  // server-side on each board render and forwarded on BoardItem so
  // SessionCard can show one of {running, error, waiting} without
  // needing access to the server-side isProcessAlive helper. Null
  // means no badge for this stage (no pipeline, or 'done').
  pipelineStatus?: "running" | "error" | "waiting" | null;
  // Multi-user read-only task: the git author of the tip commit
  // on the remote branch we discovered this task from. Rendered
  // by SessionCard as "от <name>" with the email on hover. Only
  // set on tasks discovered via scanRemoteFeatureBranches —
  // locally-created tasks leave it undefined.
  publishedBy?: { name: string; email: string };
  // Fully-qualified remote-tracking ref, e.g.
  // "origin/feature/OKECS-13078". Used to render an "open on
  // forge" link via buildBranchUrl. Only set on remote tasks.
  remoteBranch?: string;
  // Tip commit SHA we last read artifacts from. Compared with
  // the current `origin/<branch>` SHA on the next scan to
  // detect updates. Surfaced as a tooltip on the publishedBy
  // badge ("обновлено в <shortSha>"). Only set on remote tasks.
  sourceCommit?: string;
  // True when this task was discovered from a remote-tracking
  // ref (i.e. published by another user, no local worktree).
  // Drives the "remote" badge on SessionCard and the
  // "Мои / Чужие" filter on TopBar. Locally-created tasks
  // (POST /api/changes) leave this undefined / false.
  remote?: boolean;
}

export type PipelineStatus = "running" | "error" | "waiting" | null;

/**
 * Structural shape that pipelineStatus() reads. Kept local to
 * lib/openspec.ts so this file doesn't have to import TaskEntry
 * from lib/state.ts (which itself imports ChangeSummary from
 * here — circular type-only imports compile fine but are
 * distracting to read). Any TaskEntry-shaped object is
 * assignable to this.
 */
export interface PipelineTaskShape {
  stage: Stage;
  openspecNewPid?: number | null;
  openspecNewExitCode?: number | null;
  gigacodeContinuePid?: number | null;
  gigacodeContinueExitCode?: number | null;
  gigacodePid?: number | null;
  gigacodeExitCode?: number | null;
  deltaSpecCreatePid?: number | null;
  deltaSpecCreateExitCode?: number | null;
  designCreatePid?: number | null;
  designCreateExitCode?: number | null;
  adrCreatePid?: number | null;
  adrCreateExitCode?: number | null;
}

/**
 * Compute the pipeline status badge for a single task at its
 * current stage. The three badge states the UI cares about are:
 *
 *   "running" — at least one background process for this stage is
 *               still alive (openspec new change, gigacode write
 *               of proposal.md/specs/design.md/adr.md, or the
 *               developer-mode /opsx:plan spawn)
 *   "error"   — one of those processes has already exited with a
 *               non-zero code; the user has to fix something before
 *               this stage can advance
 *   "waiting" — the current stage's artefact exists on disk and
 *               no CLI step is in flight; the analyst can press
 *               "Подтверждаю" to advance the stage
 *
 * Returns `null` when the stage has no pipeline (e.g. the final
 * 'done' stage, or backlog in developer mode) — the UI then renders
 * no badge rather than a misleading "running" / "error" / "waiting".
 */
export function pipelineStatus(
  task: PipelineTaskShape,
  isAlive: (pid: number) => boolean,
  isStageReady: boolean,
): PipelineStatus {
  // PIDs to check for this stage. proposal has two steps; every
  // other analyst stage has the create-step only.
  const pids: { pid: number | null | undefined; exitCode: number | null | undefined }[] = [];
  switch (task.stage) {
    case "proposal":
      pids.push({ pid: task.openspecNewPid, exitCode: task.openspecNewExitCode });
      pids.push({
        pid: task.gigacodeContinuePid,
        exitCode: task.gigacodeContinueExitCode,
      });
      break;
    case "delta-spec":
      pids.push({
        pid: task.deltaSpecCreatePid,
        exitCode: task.deltaSpecCreateExitCode,
      });
      break;
    case "design":
      pids.push({
        pid: task.designCreatePid,
        exitCode: task.designCreateExitCode,
      });
      break;
    case "adr":
      pids.push({
        pid: task.adrCreatePid,
        exitCode: task.adrCreateExitCode,
      });
      break;
    case "develop":
    case "deploy":
      // developer-mode stages that share the single gigacode
      // /opsx:plan spawn started by /api/changes/<tag>/start.
      pids.push({ pid: task.gigacodePid, exitCode: task.gigacodeExitCode });
      break;
    default:
      return null;
  }

  // Error wins over running wins over waiting — the user needs to
  // see a broken step before anything else.
  for (const { pid, exitCode } of pids) {
    if (exitCode != null && exitCode !== 0) return "error";
  }
  for (const { pid } of pids) {
    if (pid != null && isAlive(pid)) return "running";
  }
  return isStageReady ? "waiting" : null;
}

export async function checkProposalExists(
  changePath: string,
): Promise<boolean> {
  try {
    await fs.access(path.join(changePath, "proposal.md"));
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Markdown helpers
// ============================================================================

function parseH2Sections(raw: string): { heading: string; body: string }[] {
  const lines = raw.split("\n");
  const sections: { heading: string; body: string[] }[] = [];
  let current: { heading: string; body: string[] } | null = null;

  for (const line of lines) {
    const m = line.match(/^##\s+(.+)/);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);

  return sections.map((s) => ({
    heading: s.heading,
    body: s.body.join("\n").trim(),
  }));
}

function findSection(
  sections: { heading: string; body: string }[],
  patterns: RegExp[],
): { heading: string; body: string } | undefined {
  return sections.find((s) =>
    patterns.some((p) => p.test(s.heading.trim())),
  );
}

function extractCapabilityList(body: string, subsectionPattern: RegExp): string[] {
  const lines = body.split("\n");
  let inSubsection = false;
  const result: string[] = [];

  for (const line of lines) {
    const sub = line.match(/^###\s+(.+)/);
    if (sub) {
      inSubsection = subsectionPattern.test(sub[1].trim());
      continue;
    }
    if (inSubsection) {
      const item = line.match(/^-\s+`([^`]+)`/);
      if (item) result.push(item[1]);
    }
  }
  return result;
}

function extractNumberedSubsections(body: string): string[] {
  const lines = body.split("\n");
  const result: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.match(/^###\s+\d+\./)) {
      if (current.length) result.push(current.join("\n").trim());
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) result.push(current.join("\n").trim());
  return result;
}

function extractRiskParagraphs(body: string): string[] {
  const lines = body.split("\n");
  const result: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.match(/^\*\*Risk:/)) {
      if (current.length) result.push(current.join("\n").trim());
      current = [line];
      continue;
    }
    if (line.trim() === "") {
      if (current.length) {
        result.push(current.join("\n").trim());
        current = [];
      }
      continue;
    }
    if (current.length) current.push(line);
  }
  if (current.length) result.push(current.join("\n").trim());
  return result;
}

function kebabToTitle(name: string): string {
  return name
    .split("-")
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================================
// Parsers
// ============================================================================

export function parseProposal(raw: string, changeName: string): Proposal {
  const lines = raw.split("\n");

  let title = "";
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)/);
    if (m) {
      title = m[1].trim();
      break;
    }
  }
  if (!title) title = kebabToTitle(changeName);

  const sections = parseH2Sections(raw);

  const motivation = findSection(sections, [/^Why$/i, /^Motivation$/i])?.body;
  const scope = findSection(sections, [
    /^What Changes$/i,
    /^What's changing$/i,
    /^Scope$/i,
  ])?.body;

  const capabilitiesSection = findSection(sections, [/^Capabilities$/i]);
  const newCapabilities = capabilitiesSection
    ? extractCapabilityList(capabilitiesSection.body, /^New Capabilities$/i)
    : [];
  const modifiedCapabilities = capabilitiesSection
    ? extractCapabilityList(capabilitiesSection.body, /^Modified Capabilities$/i)
    : [];

  return {
    changeName,
    title,
    raw,
    motivation,
    scope,
    sections,
    newCapabilities,
    modifiedCapabilities,
  };
}

export function parseDesign(raw: string): Design {
  const sections = parseH2Sections(raw);

  const decisionsSection = findSection(sections, [/^Decisions?$/i]);
  const decisions = decisionsSection
    ? extractNumberedSubsections(decisionsSection.body)
    : [];

  const tradeoffsSection = findSection(sections, [
    /^Risks?\s*\/\s*Trade-?offs?$/i,
    /^Trade-?offs?$/i,
    /^Alternatives?$/i,
  ]);
  const tradeoffs = tradeoffsSection
    ? extractRiskParagraphs(tradeoffsSection.body)
    : [];

  const titleMatch = raw.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1].trim() : undefined;

  return { raw, title, sections, decisions, tradeoffs };
}

export function parseSpec(raw: string, capability: string): DeltaSpec {
  let purpose: string | null = null;
  const purposeMatch = raw.match(
    /^##\s+Purpose\s*\n+([\s\S]*?)(?=\n##\s+|\n#\s+|(?![\s\S]))/m,
  );
  if (purposeMatch) purpose = purposeMatch[1].trim();

  const addedRequirements = parseRequirementsUnder(raw, "ADDED Requirements");
  const modifiedRequirements = parseRequirementsUnder(
    raw,
    "MODIFIED Requirements",
  );
  const removedRequirements = parseRequirementsUnder(
    raw,
    "REMOVED Requirements",
  );

  return {
    capability,
    purpose,
    raw,
    addedRequirements,
    modifiedRequirements,
    removedRequirements,
  };
}

function parseRequirementsUnder(raw: string, heading: string): Requirement[] {
  const sectionRe = new RegExp(
    `^##\\s+${escapeRegex(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|\\n#\\s+|(?![\\s\\S]))`,
    "m",
  );
  const sectionMatch = raw.match(sectionRe);
  if (!sectionMatch) return [];
  const sectionBody = sectionMatch[1];

  const blockRe = /(?:^|\n)###\s+Requirement:[\s\S]*?(?=\n###\s+|\n##\s+|(?![\s\S]))/g;
  const blocks = sectionBody.match(blockRe) || [];
  return blocks.map(parseRequirementBlock);
}

function parseRequirementBlock(block: string): Requirement {
  const lines = block.split("\n");
  const firstLine = lines[0];
  const nameMatch = firstLine.match(/^###\s+Requirement:\s*(.+)/);
  const name = nameMatch ? nameMatch[1].trim() : firstLine.trim();

  const scenarioStart = lines.findIndex(
    (l, i) => i > 0 && /^####\s+Scenario:/.test(l),
  );

  let body = "";
  let scenarioLines: string[] = [];
  if (scenarioStart === -1) {
    body = lines.slice(1).join("\n").trim();
  } else {
    body = lines.slice(1, scenarioStart).join("\n").trim();
    scenarioLines = lines.slice(scenarioStart);
  }

  return { name, body, scenarios: parseScenarios(scenarioLines) };
}

function parseScenarios(lines: string[]): Scenario[] {
  const scenarios: Scenario[] = [];
  let current: Scenario | null = null;

  for (const line of lines) {
    const sm = line.match(/^####\s+Scenario:\s*(.+)/);
    if (sm) {
      if (current) scenarios.push(current);
      current = { name: sm[1].trim(), when: [], then: [] };
      continue;
    }
    if (!current) continue;

    const wm = line.match(/^-\s+\*\*WHEN\*\*\s+(.+)/);
    const tm = line.match(/^-\s+\*\*THEN\*\*\s+(.+)/);
    const am = line.match(/^-\s+\*\*AND\*\*\s+(.+)/);
    if (wm) current.when.push(wm[1]);
    else if (tm) current.then.push(tm[1]);
    else if (am) current.then.push(am[1]);
  }
  if (current) scenarios.push(current);
  return scenarios;
}

// ============================================================================
// Filesystem scanner
// ============================================================================

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function emptySpecCounts(): SpecCounts {
  return { added: 0, modified: 0, removed: 0, scenarios: 0 };
}

async function readChangeSummaryFromPath(
  changePath: string,
  changeName: string,
): Promise<ChangeSummary> {
  const proposalPath = path.join(changePath, "proposal.md");
  const designPath = path.join(changePath, "design.md");
  const specsDir = path.join(changePath, "specs");

  const hasProposal = await exists(proposalPath);
  const hasDesign = await exists(designPath);
  const hasSpecs = await exists(specsDir);

  let title = kebabToTitle(changeName);
  let updatedAt = "";
  const capabilityTags: string[] = [];
  const specCounts = emptySpecCounts();
  let newCapabilities: string[] = [];
  let modifiedCapabilities: string[] = [];
  let fileCount = 0;
  let totalSize = 0;

  if (hasProposal) {
    const raw = await fs.readFile(proposalPath, "utf-8");
    const parsed = parseProposal(raw, changeName);
    title = parsed.title;
    newCapabilities = parsed.newCapabilities;
    modifiedCapabilities = parsed.modifiedCapabilities;
    const st = await fs.stat(proposalPath);
    fileCount += 1;
    totalSize += st.size;
    if (!updatedAt || st.mtime.toISOString() > updatedAt) {
      updatedAt = st.mtime.toISOString();
    }
  }

  if (hasSpecs) {
    const specDirs = await fs.readdir(specsDir, { withFileTypes: true });
    for (const dir of specDirs) {
      if (!dir.isDirectory()) continue;
      const specFile = path.join(specsDir, dir.name, "spec.md");
      if (!(await exists(specFile))) continue;
      capabilityTags.push(dir.name);
      const raw = await fs.readFile(specFile, "utf-8");
      const parsed = parseSpec(raw, dir.name);
      specCounts.added += parsed.addedRequirements.length;
      specCounts.modified += parsed.modifiedRequirements.length;
      specCounts.removed += parsed.removedRequirements.length;
      specCounts.scenarios +=
        parsed.addedRequirements.reduce((s, r) => s + r.scenarios.length, 0) +
        parsed.modifiedRequirements.reduce(
          (s, r) => s + r.scenarios.length,
          0,
        ) +
        parsed.removedRequirements.reduce(
          (s, r) => s + r.scenarios.length,
          0,
        );
      const st = await fs.stat(specFile);
      fileCount += 1;
      totalSize += st.size;
      if (!updatedAt || st.mtime.toISOString() > updatedAt) {
        updatedAt = st.mtime.toISOString();
      }
    }
  }

  if (hasDesign) {
    const st = await fs.stat(designPath);
    fileCount += 1;
    totalSize += st.size;
    if (!updatedAt || st.mtime.toISOString() > updatedAt) {
      updatedAt = st.mtime.toISOString();
    }
  }

  return {
    id: "",
    changeName,
    path: changePath,
    title,
    stage: "backlog",
    hasProposal,
    hasDesign,
    hasSpecs,
    capabilityTags,
    specCounts,
    newCapabilities,
    modifiedCapabilities,
    updatedAt,
    fileCount,
    totalSize,
  };
}

// ============================================================================
// Layout helpers
// ============================================================================

/**
 * Standard OpenSpec layout: `<repo>/openspec/changes/<tag>/...`.
 * The app's `config.openspecDir` points at the REPO ROOT, not at the
 * inner `openspec/` directory — see docs/sdd-directory.md for the
 * convention. All change-folder paths are derived from the repo root
 * via these helpers so they stay correct when the same logic runs
 * inside a worktree (whose root is also a copy of the repo).
 */
export function getChangesDir(rootDir: string): string {
  return path.join(rootDir, "openspec", "changes");
}

export function getChangePath(rootDir: string, changeName: string): string {
  return path.join(rootDir, "openspec", "changes", changeName);
}

export function getSpecsDir(rootDir: string): string {
  return path.join(rootDir, "openspec", "specs");
}

// ============================================================================
// Worktree resolution
// ============================================================================

/**
 * Resolve the on-disk root where the change folder for this task
 * lives. The analyst-mode proposal-creation flow creates a dedicated
 * worktree per task (see app/api/changes POST) and stores its path
 * on `task.openspecWorktreePath`. That field is the canonical source
 * of truth.
 *
 * When it's missing (legacy task, or a state.json that pre-dates the
 * worktree field), fall back to the on-disk convention:
 *   <openspecDirParent>/<openspecDirBasename>.worktrees/<jiraId>/
 * and verify it exists before returning. If even that doesn't pan
 * out, scan the parent `.worktrees/` directory and look for a
 * sub-folder that itself contains `changes/<tag>/`. As a last
 * resort, return openspecDir itself.
 */
export async function resolveProposalRootForTask(
  task: {
    openspecWorktreePath?: string;
    jiraUrl?: string | null;
    summary: { changeName: string };
  },
  openspecDir: string,
): Promise<string> {
  if (task.openspecWorktreePath) return task.openspecWorktreePath;
  if (!task.jiraUrl) return openspecDir;
  const jiraId = extractJiraId(task.jiraUrl);
  if (!jiraId) return openspecDir;
  const basename = repoBasename(openspecDir);
  const parent = path.dirname(openspecDir);
  const namedCandidate = path.join(parent, `${basename}.worktrees`, jiraId);
  try {
    await fs.access(
      path.join(
        namedCandidate,
        "openspec",
        "changes",
        task.summary.changeName,
      ),
    );
    return namedCandidate;
  } catch {
    /* fall through to directory-scan fallback */
  }
  // Scan <basename>.worktrees/* for a sub-folder containing
  // `openspec/changes/<tag>/`. This is robust to the convention being
  // slightly off (different jiraId casing, worktree renamed, etc.).
  const root = path.join(parent, `${basename}.worktrees`);
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = path.join(root, e.name);
      try {
        await fs.access(
          path.join(sub, "openspec", "changes", task.summary.changeName),
        );
        return sub;
      } catch {
        /* keep scanning */
      }
    }
  } catch {
    /* root not readable — keep last-resort fallback */
  }
  return openspecDir;
}

/**
 * Scan one root (a directory containing a `openspec/changes/` folder)
 * and return ChangeSummary for each change found there. Used
 * internally by scanChangeRoots.
 */
export async function scanOneRoot(rootDir: string): Promise<ChangeSummary[]> {
  const changesDir = getChangesDir(rootDir);
  if (!(await exists(changesDir))) return [];

  const entries = await fs.readdir(changesDir, { withFileTypes: true });
  const out: ChangeSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "archive") continue;
    const summary = await readChangeSummaryFromPath(
      path.join(changesDir, entry.name),
      entry.name,
    );
    out.push(summary);
  }
  return out;
}

/**
 * Scan multiple roots and merge results by changeName. Later roots in
 * the list WIN for a given changeName — this lets callers put the
 * most-up-to-date root last. Typical use: `[mainRepo, ...worktrees]`
 * so a worktree's proposal.md / specs / design.md (which are newer
 * than anything in main) override the main-repo view of the same
 * change folder.
 *
 * In normal use each change lives in exactly one root (state.json
 * tracks `openspecWorktreePath` per task), but the de-dup by name is
 * kept as a defensive measure.
 */
export async function scanChangeRoots(
  rootDirs: string[],
): Promise<ChangeSummary[]> {
  const merged = new Map<string, ChangeSummary>();
  for (const root of rootDirs) {
    const summaries = await scanOneRoot(root);
    for (const s of summaries) merged.set(s.changeName, s);
  }

  const out = Array.from(merged.values());
  out.sort((a, b) => a.changeName.localeCompare(b.changeName));

  // scanChangeRoots' main consumer today is
  // refreshAnalystTaskSummary() in lib/state.ts, which goes through
  // scanOneRoot() directly (one root per call, filtered by
  // changeName). The aggregator function itself is kept exported
  // for backwards compatibility — historical call sites that want
  // to walk multiple roots in a single pass can still use it.
  //
  // Note: /api/refresh used to feed these summaries into
  // mergeScanWithState, which auto-created entries from disk and
  // sometimes produced records whose composite-key prefix disagreed
  // with the persisted `mode` (making them invisible on the board).
  // That "create-on-disk" path has been retired; new analyst tasks
  // are created exclusively through POST /api/changes or discovered
  // by mergeRemoteFeatureScan().
  //
  // scanChangeRoots' output still carries an empty `s.id = ""`
  // placeholder: callers handle ID assignment themselves so any
  // pre-existing state entry can preserve its UUID across writes.

  return out;
}

export async function readChange(
  openspecDir: string,
  changeName: string,
): Promise<Change> {
  const changePath = getChangePath(openspecDir, changeName);
  const summary = await readChangeSummaryFromPath(changePath, changeName);

  let proposal: Proposal | null = null;
  let design: Design | null = null;
  const specs: DeltaSpec[] = [];

  if (summary.hasProposal) {
    const proposalPath = path.join(changePath, "proposal.md");
    const raw = await fs.readFile(proposalPath, "utf-8");
    proposal = parseProposal(raw, changeName);
  }

  if (summary.hasDesign) {
    const designPath = path.join(changePath, "design.md");
    const raw = await fs.readFile(designPath, "utf-8");
    design = parseDesign(raw);
  }

  if (summary.hasSpecs) {
    const specsDir = path.join(changePath, "specs");
    const specDirs = await fs.readdir(specsDir, { withFileTypes: true });
    for (const dir of specDirs) {
      if (!dir.isDirectory()) continue;
      const specFile = path.join(specsDir, dir.name, "spec.md");
      if (!(await exists(specFile))) continue;
      const raw = await fs.readFile(specFile, "utf-8");
      specs.push(parseSpec(raw, dir.name));
    }
  }

  return {
    ...summary,
    proposal,
    design,
    specs,
  };
}

/**
 * `readChange` for a remote task whose content lives in git rather
 * than on disk. Reads proposal.md / design.md and the specs
 * directory contents at `ref` via `git show` and builds the same
 * Change shape, so the API contract is identical regardless of
 * where the task's artifacts live. Non-throwing when a file is
 * absent — the corresponding field stays null / empty, matching the
 * on-disk behaviour.
 */
export async function readChangeFromGit(
  repoDir: string,
  ref: string,
  changeName: string,
): Promise<Change> {
  const paths = await listGitChangePaths(repoDir, ref, changeName);
  const hasProposal = paths !== null && paths.includes("proposal.md");
  const hasDesign = paths !== null && paths.includes("design.md");
  const hasSpecs =
    paths !== null && paths.some((p) => p.startsWith("specs/"));

  // Files / sizes come from the git tree so the summary matches
  // what the file-tree view shows.
  let fileCount = 0;
  let totalSize = 0;
  const tree = await listGitChangeTree(repoDir, ref, changeName);
  if (tree) fileCount = countTreeFiles(tree);

  async function gitFile(relPath: string): Promise<string> {
    const { stdout } = await runGitIn(repoDir, [
      "show",
      `${ref}:openspec/changes/${changeName}/${relPath}`,
    ]);
    return stdout;
  }

  let summaryTitle = kebabToTitle(changeName);
  let proposal: Proposal | null = null;
  let design: Design | null = null;
  const specs: DeltaSpec[] = [];
  const capabilityTags: string[] = [];
  const specCounts = emptySpecCounts();
  let newCapabilities: string[] = [];
  let modifiedCapabilities: string[] = [];

  if (hasProposal) {
    try {
      const raw = await gitFile("proposal.md");
      proposal = parseProposal(raw, changeName);
      summaryTitle = proposal.title;
      totalSize += raw.length;
      newCapabilities = proposal.newCapabilities;
      modifiedCapabilities = proposal.modifiedCapabilities;
    } catch {
      /* proposal unreadable — keep null */
    }
  }

  if (hasDesign) {
    try {
      const raw = await gitFile("design.md");
      design = parseDesign(raw);
      totalSize += raw.length;
    } catch {
      /* design unreadable — keep null */
    }
  }

  if (hasSpecs) {
    for (const rel of paths ?? []) {
      const m = rel.match(/^specs\/([^/]+)\/spec\.md$/);
      if (!m) continue;
      try {
        const raw = await gitFile(rel);
        capabilityTags.push(m[1]);
        specs.push(parseSpec(raw, m[1]));
        totalSize += raw.length;
      } catch {
        /* skip unreadable spec */
      }
    }
  }

  for (const s of specs) {
    specCounts.added += s.addedRequirements.length;
    specCounts.modified += s.modifiedRequirements.length;
    specCounts.removed += s.removedRequirements.length;
    specCounts.scenarios +=
      s.addedRequirements.reduce((sum, r) => sum + r.scenarios.length, 0) +
      s.modifiedRequirements.reduce((sum, r) => sum + r.scenarios.length, 0) +
      s.removedRequirements.reduce((sum, r) => sum + r.scenarios.length, 0);
  }

  return {
    id: "",
    changeName,
    path: "",
    title: summaryTitle,
    stage: "backlog",
    hasProposal,
    hasDesign,
    hasSpecs,
    capabilityTags,
    specCounts,
    newCapabilities,
    modifiedCapabilities,
    updatedAt: "",
    fileCount,
    totalSize,
    proposal,
    design,
    specs,
  };
}

function countTreeFiles(node: TreeNode): number {
  if (node.type === "file") return 1;
  if (!node.children) return 0;
  return node.children.reduce((sum, c) => sum + countTreeFiles(c), 0);
}

// ============================================================================
// File tree
// ============================================================================

export interface TreeNode {
  name: string;
  relativePath: string;
  absolutePath: string;
  type: "file" | "directory";
  size: number;
  children?: TreeNode[];
}

const SKIP_DOTFILES = true;
// tasks.md used to be skipped because the openspec stores this
// project reads from never carried it (project's openspec
// workflow is proposal + specs + design + ADR; tasks.md is a
// standard openspec field that was simply absent). The
// developer-mode plan pipeline now GENERATES tasks.md into
// <change>/tasks.md, so skipping it would hide the very file
// the user just watched gigacode write. Leave the set empty
// until/unless we add another file we want to hide.
const SKIP_FILES = new Set<string>();

async function buildTreeNode(
  absPath: string,
  relPath: string,
): Promise<TreeNode | null> {
  const stat = await fs.stat(absPath);

  if (stat.isDirectory()) {
    const entries = await fs.readdir(absPath, { withFileTypes: true });
    const children: TreeNode[] = [];
    let totalSize = 0;

    for (const entry of entries) {
      if (SKIP_DOTFILES && entry.name.startsWith(".")) continue;
      if (SKIP_FILES.has(entry.name)) continue;
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      const childAbs = path.join(absPath, entry.name);
      const node = await buildTreeNode(childAbs, childRel);
      if (node) {
        children.push(node);
        totalSize += node.size;
      }
    }

    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      name: path.basename(absPath),
      relativePath: relPath,
      absolutePath: absPath,
      type: "directory",
      size: totalSize,
      children,
    };
  }

  return {
    name: path.basename(absPath),
    relativePath: relPath,
    absolutePath: absPath,
    type: "file",
    size: stat.size,
  };
}

export async function listChangeTree(
  changePath: string,
): Promise<TreeNode | null> {
  if (!(await exists(changePath))) return null;
  return await buildTreeNode(changePath, "");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Artifact source resolution
// ============================================================================

/**
 * Locate where a task's change-artifacts (proposal.md, specs/,
 * design.md, adr.md) live for the display layer.
 *
 * Remote tasks (published by another user, discovered via
 * scanRemoteFeatureBranches) have NO on-disk worktree —
 * `openspecWorktreePath` is absent. Their content exists only in
 * git, on the branch whose tip we captured in `sourceCommit`. For
 * those we resolve to a `git` source and read files via
 * `git ls-tree` / `git show` against the stored SHA.
 *
 * Every other task (local worktrees, legacy tasks whose folder is on
 * disk) resolves to the existing `resolveProposalRootForTask`
 * convention and reads from the filesystem.
 *
 * The display layer branches once on `kind` and then uses either the
 * filesystem helpers (`checkProposalExists`, `isStageReady`,
 * `listChangeTree`) or their `*FromGit` counterparts below.
 */
export type ArtifactSource =
  | { kind: "git"; repoDir: string; ref: string; changeName: string }
  | { kind: "fs"; root: string };

export async function resolveArtifactSource(
  task: {
    remote?: boolean;
    sourceCommit?: string;
    summary: { changeName: string };
    openspecWorktreePath?: string;
    jiraUrl?: string | null;
  },
  openspecDir: string,
): Promise<ArtifactSource> {
  // A remote task whose read-only mirror worktree has been
  // materialized reads from the filesystem like a local task (the
  // mirror path is stored on openspecWorktreePath). We only fall
  // back to git-reading when the mirror isn't there yet — the async
  // window between a remote branch first being seen and its worktree
  // being created, or an earlier materialization failure that the
  // next scan will retry.
  if (
    task.remote === true &&
    task.sourceCommit &&
    !task.openspecWorktreePath
  ) {
    return {
      kind: "git",
      repoDir: openspecDir,
      ref: task.sourceCommit,
      changeName: task.summary.changeName,
    };
  }
  return {
    kind: "fs",
    root: await resolveProposalRootForTask(task, openspecDir),
  };
}

// ============================================================================
// .openspec.yaml — per-change stage metadata (published by the author)
// ============================================================================

/**
 * Path of the per-change metadata file, relative to the change
 * folder: `openspec/changes/<changeName>/.openspec.yaml`. Created by
 * `openspec new change` and updated by the «Опубликовать» flow to
 * carry the stage the author has published.
 */
export function openspecYamlPath(changePath: string): string {
  return path.join(changePath, ".openspec.yaml");
}

/**
 * Stages that may legally appear in `.openspec.yaml`. Anything else
 * (unknown / hand-edited values) is treated as "no stage recorded"
 * and falls back to file-presence inference.
 */
const YAML_STAGES = new Set([
  "proposal",
  "delta-spec",
  "design",
  "adr",
  "done",
]);

/**
 * Read the published `stage` from a change's `.openspec.yaml`.
 *
 * Parsing is intentionally a single-line regex (no YAML dependency):
 * the file is written by us and by the openspec CLI, both emitting
 * the flat `stage: <value>` form. Returns null when the file is
 * missing, unreadable, or carries no/invalid stage — callers fall
 * back to artifact-presence inference.
 */
export async function readStageFromOpenspecYaml(
  root: string,
  changeName: string,
): Promise<Stage | null> {
  let raw: string;
  try {
    raw = await fs.readFile(
      openspecYamlPath(path.join(root, "openspec", "changes", changeName)),
      "utf-8",
    );
  } catch {
    return null;
  }
  const m = raw.match(/^stage:\s*["']?([\w-]+)["']?\s*$/m);
  if (!m) return null;
  const value = m[1];
  return YAML_STAGES.has(value) ? (value as Stage) : null;
}

/**
 * Update (or add) the `stage:` key in a change's `.openspec.yaml`
 * inside a local worktree. Returns true when the file content
 * changed. Never commits — the caller (publish-stage route) is
 * responsible for the git add/commit so the timing stays in one
 * place.
 */
export async function updateStageInOpenspecYaml(
  root: string,
  changeName: string,
  stage: Stage,
): Promise<boolean> {
  const yamlPath = openspecYamlPath(
    path.join(root, "openspec", "changes", changeName),
  );
  const line = `stage: ${stage}`;
  let raw: string | null = null;
  try {
    raw = await fs.readFile(yamlPath, "utf-8");
  } catch {
    raw = null;
  }

  let next: string;
  if (raw == null) {
    // No metadata file yet (older changes created before the key
    // existed) — synthesize a minimal one.
    next = `changeName: ${changeName}\n${line}\n`;
  } else if (/^stage:\s*.*$/m.test(raw)) {
    next = raw.replace(/^stage:\s*.*$/m, line);
  } else {
    // File exists but has no stage key — append it.
    next = raw.endsWith("\n") ? raw + line + "\n" : raw + "\n" + line + "\n";
  }

  if (next === raw) return false;
  await fs.mkdir(path.dirname(yamlPath), { recursive: true });
  await atomicWriteFile(yamlPath, next);
  return true;
}

// ============================================================================
// Git-backed artifact reading (remote tasks)
// ============================================================================

async function runGitIn(
  repoDir: string,
  args: string[],
  opts?: { maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", repoDir, ...args],
      { maxBuffer: opts?.maxBuffer ?? 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `git ${args.join(" ")} failed: ${err.message}\n${stderr}`,
            ),
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * Enumerate the paths (git-quoted) under `openspec/changes/<changeName>/`
 * at a given ref, as a flat array like
 * `[proposal.md, specs/credit-scoring/spec.md, design.md]`.
 * Paths are already stripped of the change-folder prefix, so the
 * caller builds a tree off them.
 *
 * Returns null when the ref or the path doesn't exist (e.g. the
 * stored sourceCommit isn't present in the local mirror yet) — the
 * caller treats a null as "folder missing" rather than throwing.
 */
async function listGitChangePaths(
  repoDir: string,
  ref: string,
  changeName: string,
): Promise<string[] | null> {
  try {
    const { stdout } = await runGitIn(repoDir, [
      "ls-tree",
      "-r",
      "--name-only",
      "--full-tree",
      ref,
      `openspec/changes/${changeName}/`,
    ]);
    if (!stdout.trim()) return [];
    const prefix = `openspec/changes/${changeName}/`;
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p));
  } catch {
    return null;
  }
}

/**
 * Mirror of the on-disk `listChangeTree` that reads the change folder
 * from git instead of the filesystem. Used for remote tasks whose
 * content lives only on the branch, not in a local worktree.
 *
 * The tree shape matches `TreeNode` exactly so the existing
 * `FileTree` component can render it unchanged.
 */
export async function listGitChangeTree(
  repoDir: string,
  ref: string,
  changeName: string,
): Promise<TreeNode | null> {
  // `--long` appends the blob size column so the tree can show
  // per-file sizes without unpacking the blobs. Directories get a
  // size that's the sum of their children.
  let stdout: string;
  try {
    const res = await runGitIn(repoDir, [
      "ls-tree",
      "-r",
      "--long",
      "--full-tree",
      ref,
      `openspec/changes/${changeName}/`,
    ]);
    stdout = res.stdout;
  } catch {
    return null;
  }
  if (!stdout.trim()) return null;

  // Parse "<mode> <type> <sha> <size>\t<path>".
  const paths: string[] = [];
  const sizes = new Map<string, number>();
  const prefix = `openspec/changes/${changeName}/`;
  for (const line of stdout.split("\n")) {
    const line_ = line.trim();
    if (!line_) continue;
    const tab = line_.indexOf("\t");
    if (tab === -1) continue;
    const meta = line_.slice(0, tab);
    const rawPath = line_.slice(tab + 1);
    if (!rawPath.startsWith(prefix)) continue;
    const rel = rawPath.slice(prefix.length);
    if (rel.split("/").some((seg) => seg.startsWith("."))) continue; // SKIP_DOTFILES
    paths.push(rel);
    const metaParts = meta.split(/\s+/).filter(Boolean);
    const size = Number(metaParts[3]);
    if (Number.isFinite(size)) sizes.set(rel, size);
  }

  // Build a nested map of name -> { type, children|size }.
  interface GitNode {
    type: "file" | "directory";
    size: number;
    children: Map<string, GitNode>;
  }
  const root: GitNode = {
    type: "directory",
    size: 0,
    children: new Map(),
  };

  for (const rel of paths) {
    const parts = rel.split("/").filter(Boolean);
    if (SKIP_FILES.has(parts[parts.length - 1])) continue;
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      if (isFile) {
        node.children.set(part, {
          type: "file",
          size: sizes.get(rel) ?? 0,
          children: new Map(),
        });
      } else {
        let child = node.children.get(part);
        if (!child) {
          child = { type: "directory", size: 0, children: new Map() };
          node.children.set(part, child);
        }
        node = child;
      }
    }
  }

  // Recursively convert the nested map into an ordered TreeNode list.
  function toTreeNodes(node: GitNode, relPath: string): TreeNode[] {
    const out: TreeNode[] = [];
    for (const [name, child] of node.children) {
      const childRel = relPath ? `${relPath}/${name}` : name;
      if (child.type === "file") {
        out.push({
          name,
          relativePath: childRel,
          absolutePath: "",
          type: "file",
          size: child.size,
        });
      } else {
        const children = toTreeNodes(child, childRel);
        const total = children.reduce((s, c) => s + c.size, 0);
        out.push({
          name,
          relativePath: childRel,
          absolutePath: "",
          type: "directory",
          size: total,
          children,
        });
      }
    }
    out.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  const children = toTreeNodes(root, "");
  return {
    name: changeName,
    relativePath: "",
    absolutePath: "",
    type: "directory",
    size: children.reduce((s, c) => s + c.size, 0),
    children,
  };
}

/**
 * True when `openspec/changes/<changeName>/<subpath>` exists at `ref`.
 * Mirrors the on-disk `checkProposalExists` (file probe). Non-throwing:
 * a missing ref / path yields false.
 */
export async function gitPathExists(
  repoDir: string,
  ref: string,
  changeName: string,
  subpath: string,
): Promise<boolean> {
  const paths = await listGitChangePaths(repoDir, ref, changeName);
  if (paths === null) return false;
  return paths.includes(subpath);
}

/**
 * True when `proposal.md` exists at the change folder root on the
 * branch. Compose `gitPathExists`; keeps call sites readable.
 */
export async function checkProposalExistsFromGit(
  repoDir: string,
  ref: string,
  changeName: string,
): Promise<boolean> {
  return gitPathExists(repoDir, ref, changeName, "proposal.md");
}

/**
 * True when the artifact for the given stage exists in the change
 * folder on the branch — the git-backed equivalent of
 * `isStageReady` from lib/continuation.ts. For "specs" we look for
 * any path under `specs/` (a non-empty directory); for
 * proposal/design/adr we look for the exact file.
 *
 * `artifactSubpath` carries the same semantics as the
 * `ArtifactConfig.artifactSubpath` used by the on-disk check:
 * "specs" (directory) or "design.md"/"adr.md" (file).
 */
export async function isStageReadyFromGit(
  repoDir: string,
  ref: string,
  changeName: string,
  artifactSubpath: string,
): Promise<boolean> {
  const paths = await listGitChangePaths(repoDir, ref, changeName);
  if (paths === null) return false;

  if (artifactSubpath.endsWith("/") || artifactSubpath === "specs") {
    const dir = artifactSubpath.replace(/\/+$/, "");
    return paths.some((p) => p.startsWith(`${dir}/`) || p === dir);
  }
  return paths.includes(artifactSubpath);
}