/**
 * Read change-proposals off the sdd-store's tracked branch
 * (config.defaultBranch, typically 'master' or 'main'). The dev
 * board consumes the result: every entry becomes a backlog task,
 * and an entry that's only present in `openspec/changes/archive/`
 * flips the existing task's `archived` flag instead of spawning
 * a new one.
 *
 * All file access goes through the host's `git` binary — we never
 * check out a worktree, never run a `git archive`/untar pipeline.
 * The calls are per-file (`git show <sha>:<path>`), which makes
 * the scan O(N) for N change-proposals and fine for a small
 * board.
 */

import { execFile } from "child_process";

function runGit(
  cwd: string,
  args: string[],
  opts?: { maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { maxBuffer: opts?.maxBuffer ?? 4 * 1024 * 1024 },
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

export interface ScannedProposal {
  tag: string;
  title: string;
  description: string;
  jiraUrl: string | null;
  /** Commit SHA on the tracked branch where the change lives. */
  sha: string;
  /**
   * `true` when the change is in `openspec/changes/archive/`
   * (and not in `openspec/changes/`) — i.e. it was applied
   * upstream and is no longer active. Existing tasks in
   * non-backlog stages get the archived flag flipped instead
   * of being removed; backlog tasks ARE removed (the dev
   * workflow never picked them up).
   */
  archived: boolean;
}

/**
 * Run a one-shot scan of `<openspecDir>`'s `<branch>` for
 * change-proposals. Returns the proposals, ready to be folded
 * into state.json.
 */
export async function scanChangeProposalsOnBranch(
  openspecDir: string,
  branch: string,
): Promise<ScannedProposal[]> {
  // 1) Make sure the branch ref is local + up to date.
  //    `git fetch origin <branch>` is per-branch — cheap even on
  //    big repos, and it's the only way to get the current
  //    origin/<branch> SHA.
  try {
    await runGit(openspecDir, ["fetch", "origin", branch]);
  } catch (e) {
    // Fetch failure is non-fatal: we can still try the local
    // ref. The caller decides how to surface the error.
    console.warn(`[scanner] git fetch origin ${branch} failed:`, e);
  }

  // 2) Resolve the branch SHA. `git ls-remote` covers the
  //    case where we couldn't fetch (so origin/<branch> is
  //    still stale).
  let sha: string | null = null;
  try {
    const { stdout } = await runGit(openspecDir, [
      "ls-remote",
      "origin",
      branch,
    ]);
    const line = stdout
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean);
    if (line) sha = line.split(/\s+/).pop() ?? null;
  } catch {
    sha = null;
  }
  if (!sha) {
    // Local ref as a last resort.
    try {
      const { stdout } = await runGit(openspecDir, [
        "rev-parse",
        "--verify",
        `refs/remotes/origin/${branch}`,
      ]);
      sha = stdout.trim() || null;
    } catch {
      return [];
    }
  }
  if (!sha) return [];

  // 3) Enumerate `openspec/changes/**/proposal.md` on that SHA.
  //    Use a single ls-tree call and parse — the alternative
  //    (git diff --name-only with a base ref) is far noisier.
  const { stdout: treeOut } = await runGit(openspecDir, [
    "ls-tree",
    "-r",
    "--name-only",
    sha,
    "openspec/changes/",
  ]);
  const paths = treeOut
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // 4) Reduce to unique tags, with a flag for whether the
  //    proposal.md is in `archive/` (archived) or in
  //    `openspec/changes/<tag>/` (live).
  const tagInfo = new Map<
    string,
    { live: boolean; archived: boolean }
  >();
  for (const path of paths) {
    const m = path.match(/^openspec\/changes\/([^/]+)\/proposal\.md$/);
    if (!m) continue;
    const tag = m[1];
    const entry = tagInfo.get(tag) ?? { live: false, archived: false };
    if (path.startsWith("openspec/changes/archive/")) {
      entry.archived = true;
    } else if (path.startsWith("openspec/changes/")) {
      entry.live = true;
    }
    tagInfo.set(tag, entry);
  }

  // 5) For each tag, fetch proposal.md (if live) and parse.
  const out: ScannedProposal[] = [];
  for (const [tag, { live, archived }] of tagInfo) {
    if (!live && !archived) continue;
    let title = tag;
    let description = "";
    let jiraUrl: string | null = null;
    if (live) {
      try {
        const { stdout: md } = await runGit(openspecDir, [
          "show",
          `${sha}:openspec/changes/${tag}/proposal.md`,
        ]);
        const parsed = parseProposalMarkdown(md);
        title = parsed.title;
        description = parsed.description;
        jiraUrl = parsed.jiraUrl;
      } catch (e) {
        // Live proposal.md we can't read — treat as archived so
        // it doesn't dangle as a half-state task.
        console.warn(`[scanner] could not read ${tag}/proposal.md:`, e);
      }
    }
    out.push({
      tag,
      title,
      description,
      jiraUrl,
      sha,
      archived: !live && archived,
    });
  }

  // Stable order: by tag name. Lets the dev scan the list
  // without it shuffling on every refresh.
  out.sort((a, b) => a.tag.localeCompare(b.tag));
  return out;
}

/**
 * Parse the bits of proposal.md we surface in the board UI:
 *   - title: first `# Heading`. Falls back to the raw text
 *     up to the first newline, then the tag.
 *   - description: first paragraph after the title (the prose
 *     between the title line and the next blank line or the
 *     next `#`/`##` heading).
 *   - jiraUrl: a Jira URL inside the markdown, or a `Jira: <id>`
 *     line that we promote to a `https://...atlassian.../browse/<id>`
 *     URL using the optional `jiraBase` override.
 */
export function parseProposalMarkdown(
  md: string,
  jiraBase?: string,
): { title: string; description: string; jiraUrl: string | null } {
  const title = extractTitle(md);
  const description = extractDescription(md);
  const jiraUrl = extractJiraUrl(md, jiraBase);
  return { title, description, jiraUrl };
}

function extractTitle(md: string): string {
  // First '# ' (or '## ', etc.) line — the first heading wins.
  const m = md.match(/^#{1,6}\s+(.+?)\s*$/m);
  if (!m) {
    // No heading at all — take the first non-empty line.
    const first = md
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean);
    return first ?? "";
  }
  return m[1].trim();
}

function extractDescription(md: string): string {
  // After the first heading, take lines up to the next blank
  // line or the next heading. That's the first paragraph of
  // free-form prose the analyst wrote under the title.
  const lines = md.split("\n");
  let pastTitle = false;
  const out: string[] = [];
  for (const line of lines) {
    if (!pastTitle) {
      if (/^#{1,6}\s/.test(line)) pastTitle = true;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) break;
    if (line.trim() === "") {
      if (out.length > 0) break;
      continue;
    }
    out.push(line);
  }
  return out.join(" ").trim();
}

function extractJiraUrl(md: string, jiraBase?: string): string | null {
  // 1. Explicit https://...atlassian.../browse/ENG-1234 anywhere.
  const url = md.match(
    /https?:\/\/\S*atlassian\S*\/browse\/[A-Z0-9][A-Z0-9_]*-\d+/i,
  );
  if (url) return url[0];

  // 2. "Jira: ENG-1234" or "JIRA: https://..." line.
  const jiraLine = md.match(/\b[Jj]ira[:\s]+(\S+)/);
  if (jiraLine) {
    const ref = jiraLine[1];
    if (/^https?:\/\//.test(ref)) return ref;
    if (jiraBase) return `${jiraBase.replace(/\/+$/, "")}/browse/${ref}`;
  }
  return null;
}