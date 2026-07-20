import fs from "fs/promises";
import path from "path";

// ============================================================================
// Types
// ============================================================================

export type Stage =
  | "backlog"
  | "decomposition"
  | "plan"
  | "develop"
  | "tests"
  | "deploy"
  | "done";

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

export async function scanChanges(openspecDir: string): Promise<ChangeSummary[]> {
  const changesDir = path.join(openspecDir, "changes");
  if (!(await exists(changesDir))) return [];

  const entries = await fs.readdir(changesDir, { withFileTypes: true });
  const summaries: ChangeSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "archive") continue;
    const summary = await readChangeSummaryFromPath(
      path.join(changesDir, entry.name),
      entry.name,
    );
    summaries.push(summary);
  }

  summaries.sort((a, b) => a.changeName.localeCompare(b.changeName));

  summaries.forEach((s, i) => {
    s.id = `OS-${String(i + 1).padStart(3, "0")}`;
  });

  return summaries;
}

export async function readChange(
  openspecDir: string,
  changeName: string,
): Promise<Change> {
  const changePath = path.join(openspecDir, "changes", changeName);
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
const SKIP_FILES = new Set(["tasks.md"]);

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

export async function listChangeTree(changePath: string): Promise<TreeNode> {
  const root = await buildTreeNode(changePath, "");
  if (!root) throw new Error(`Cannot read change folder: ${changePath}`);
  return root;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}