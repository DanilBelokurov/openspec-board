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
  /**
   * Presence of the upstream artifacts (design.md, specs/) on
   * the tracked branch. The dev-mode card renders a
   * "Нет артефактов" warning when any of these is false, so
   * the scanner must reflect the real file-system state on the
   * branch — not a hardcoded default. Only meaningful for live
   * proposals; archived ones always carry `false` here.
   */
  hasDesign: boolean;
  hasSpecs: boolean;
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
  // 1) Make sure the branch ref is local + up to date. After this
  //    completes, refs/remotes/origin/<branch> reflects the latest
  //    remote state.
  let fetchOk = true;
  try {
    await runGit(openspecDir, ["fetch", "origin", branch]);
  } catch (e) {
    // Fetch failure is non-fatal: we can still ask the remote
    // directly via `ls-remote`. The caller decides how to surface
    // the error.
    fetchOk = false;
    console.warn(`[scanner] git fetch origin ${branch} failed:`, e);
  }

  // 2) Resolve the branch SHA. After a successful fetch, the local
  //    mirror refs/remotes/origin/<branch> carries the SHA directly
  //    and we don't need to parse `git ls-remote` text. Fall back to
  //    `ls-remote` only when fetch failed (so the local mirror is
  //    stale or missing).
  let sha: string | null = null;
  if (fetchOk) {
    try {
      const { stdout } = await runGit(openspecDir, [
        "rev-parse",
        "--verify",
        `refs/remotes/origin/${branch}`,
      ]);
      sha = stdout.trim() || null;
    } catch {
      sha = null;
    }
  }
  if (!sha) {
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
      if (line) {
        // Format: "<sha>\t<refname>" — SHA is the FIRST
        // whitespace-separated token. (.pop() previously returned
        // the refname, which is a valid string but not a SHA — so
        // the subsequent `git ls-tree <sha>` resolved to the LOCAL
        // ref, which can be behind origin/<branch>.)
        sha = line.split(/\s+/)[0] ?? null;
      }
    } catch {
      sha = null;
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
  //    `openspec/changes/<tag>/` (live). We also collect
  //    design.md / specs/* presence from the same ls-tree
  //    output — those drive the "Нет артефактов" warning on
  //    dev-board cards, so the scanner must reflect the real
  //    file-system state on the branch, not a hardcoded default.
  const tagInfo = new Map<
    string,
    {
      live: boolean;
      archived: boolean;
      hasDesign: boolean;
      hasSpecs: boolean;
    }
  >();
  const tagAtPath = (path: string): string | null => {
    const m = path.match(/^openspec\/changes\/([^/]+)\//);
    return m && m[1] !== "archive" ? m[1] : null;
  };
  for (const path of paths) {
    if (path.startsWith("openspec/changes/archive/")) {
      // Archive trees only carry the proposal.md (and any
      // historical artifacts copied in). The dev board doesn't
      // surface them, so we don't track artifact flags here.
      const m = path.match(/^openspec\/changes\/archive\/([^/]+)\/proposal\.md$/);
      if (m) {
        const tag = m[1];
        const entry = tagInfo.get(tag) ?? {
          live: false,
          archived: false,
          hasDesign: false,
          hasSpecs: false,
        };
        entry.archived = true;
        tagInfo.set(tag, entry);
      }
      continue;
    }
    const tag = tagAtPath(path);
    if (!tag) continue;
    const entry = tagInfo.get(tag) ?? {
      live: false,
      archived: false,
      hasDesign: false,
      hasSpecs: false,
    };
    if (path.endsWith("/proposal.md")) {
      entry.live = true;
    }
    if (path.endsWith("/design.md")) {
      entry.hasDesign = true;
    }
    if (path.includes("/specs/")) {
      // specs/ may contain nested capability dirs + spec.md
      // files. The presence of ANY specs/* path is enough to
      // mark the proposal as having delta-specs.
      entry.hasSpecs = true;
    }
    tagInfo.set(tag, entry);
  }

  // 5) For each tag, fetch proposal.md (if live) and parse.
  const out: ScannedProposal[] = [];
  for (const [tag, { live, archived, hasDesign, hasSpecs }] of tagInfo) {
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
      // Artifact flags are only meaningful for live proposals;
      // for archived we leave them false so the merge scan
      // doesn't accidentally clear them on a stale entry.
      hasDesign: live ? hasDesign : false,
      hasSpecs: live ? hasSpecs : false,
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