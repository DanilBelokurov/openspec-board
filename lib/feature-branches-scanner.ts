/**
 * Scan `origin/feature/*` branches on the openspec-store remote
 * for change-proposals published by other users.
 *
 * The board uses this to surface remote-only tasks in analyst
 * mode: when user A pushes `feature/OKECS-13078` with a proposal
 * and user B's watcher runs this scanner, B sees a read-only
 * card on the analyst board with A as the author. B can read the
 * proposal/specs/design/adr from the remote-tracking ref but
 * has no local worktree, no openspecNewPid, and no way to push
 * to A's branch (that lives in the deferred "track" flow).
 *
 * Workflow (per scan):
 *
 *   1. `git fetch origin --prune` — refresh every
 *      refs/remotes/origin/** in one shot. `--prune` ensures
 *      branches deleted upstream disappear from our ref space.
 *   2. `git for-each-ref refs/remotes/origin/feature/` — list all
 *      feature branches. `--format` reads SHA + author in one
 *      call (no N invocations of `git log`).
 *   3. For each ref, sanity-check the JIRA-ID pattern
 *      (`<KEY>-<digits>`) — refuse WIP / scratch branches.
 *   4. For each surviving ref, `git ls-tree <sha>
 *      openspec/changes/` — decide whether there's a proposal.md
 *      and capture the change-tag plus presence of design.md /
 *      specs/. Without proposal.md the branch is ignored
 *      (a feature branch with no proposal is not a valid task).
 *   5. `git show <sha>:openspec/changes/<tag>/proposal.md` —
 *      parse title / description / jiraUrl via the same
 *      `parseProposalMarkdown` helper the dev-mode scanner uses,
 *      so the rendered card looks identical to a local one.
 *
 * Returns an array of `RemoteBranchProposal` — one per valid
 * branch. The merge step in `lib/state.ts` decides whether to
 * create a new task, refresh an existing one, or skip a conflict.
 *
 * Error handling: every git call has a try/catch — a single
 * broken branch (corrupt object, missing tree) must not abort
 * the whole scan. Failures are surfaced via
 * `RemoteBranchProposal.error`, never thrown out of the scanner
 * — the watcher logs them and moves on.
 */

import { execFile } from "child_process";
import { parseProposalMarkdown } from "./openspec-scanner";
import { readChangeMetadataFromGit } from "./openspec";
import { JIRA_ID_PATTERN } from "./jira";

function runGit(
  cwd: string,
  args: string[],
  opts?: { maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      // Default 16MB — `git ls-tree -r` over a large
      // openspec/changes/ tree (hundreds of capability specs)
      // can produce multi-MB output, and a proposal.md can be
      // a single big prose blob. 4MB (Node's older default)
      // truncated real scans in the field — bumped to 16MB
      // to match the proposal-read buffer.
      { maxBuffer: opts?.maxBuffer ?? 16 * 1024 * 1024 },
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

export interface RemoteBranchProposal {
  /**
   * Branch name without the remote namespace.
   * "feature/OKECS-13078"
   */
  branch: string;
  /**
   * Full remote-tracking ref. "origin/feature/OKECS-13078".
   * This is what we store on `TaskEntry.remoteBranch` and feed
   * to `buildBranchUrl` to render the "open on forge" link.
   */
  remoteRef: string;
  /** JIRA id parsed from the branch name. "OKECS-13078". */
  jiraId: string;
  /** Tip commit SHA. Compared with `sourceCommit` to detect updates. */
  sha: string;
  /** Git author of the tip commit (`%an <%ae>`). */
  publishedBy: { name: string; email: string };
  /** Whether `openspec/changes/<tag>/proposal.md` exists. */
  hasProposal: boolean;
  /**
   * The change-tag (folder name) under `openspec/changes/`.
   * `null` when no proposal.md was found. This is the canonical
   * task identifier — branch names are advisory, the tag is
   * what the board keys on.
   */
  tag: string | null;
  /** Parsed proposal.md fields. Undefined when proposal.md is missing. */
  proposalTitle?: string;
  proposalDescription?: string;
  jiraUrl?: string | null;
  /** Artifact presence (drives the "Нет артефактов" warning). */
  hasSpecs: boolean;
  hasDesign: boolean;
  /**
   * Whether `openspec/changes/<tag>/adr.md` exists. Drives
   * the inferred stage to "adr" when the published .openspec.yaml
   * is missing or unreadable. Mirrors the local analyst flow's
   * `adrCreate*` field semantics.
   */
  hasAdr: boolean;
  /**
   * Title parsed from the change's `.openspec.yaml`, if that file
   * exists on the branch and carries a `title:` key. Takes priority
   * over `proposalTitle` (parsed from proposal.md) in the merge step
   * because the author re-emits `.openspec.yaml` at every publish,
   * whereas proposal.md is only edited when the analyst actually
   * rewrites the markdown — so yaml stays accurate even after a
   * cosmetic title tweak the analyst forgot to propagate to
   * proposal.md.
   *
   * Always present in the return value once we know there is a
   * proposal.md; null when the file/key is missing or unreadable —
   * callers fall back to `proposalTitle` in that case.
   */
  yamlTitle: string | null;
  /**
   * Stage read straight out of `.openspec.yaml` on the branch.
   * Mirrors the ground-truth role the local-worktree
   * `readStageFromOpenspecYaml` plays: when set, the merge step
   * uses this verbatim instead of inferring it from artifact
   * presence. Null when the file/key is missing/invalid —
   * inference kicks in.
   */
  yamlStage: import("./openspec").Stage | null;
  /**
   * Per-branch error message. Set when one of the git calls for
   * THIS branch failed; the rest of the result fields may be
   * partial. Callers should treat `error` as a non-fatal signal:
   * "this branch couldn't be inspected right now, skip it".
   */
  error?: string;
}

/**
 * Run `git fetch origin --prune`. Refreshes every
 * refs/remotes/origin/** in one shot. NOT fatal on failure —
 * we degrade gracefully against the last-known ref state so
 * transient network blips don't blank the board.
 */
async function fetchOrigin(openspecDir: string): Promise<void> {
  try {
    await runGit(openspecDir, ["fetch", "origin", "--prune"]);
  } catch (e) {
    console.warn(
      "[feature-branches-scanner] git fetch origin --prune failed:",
      e,
    );
  }
}

/**
 * List every `refs/remotes/origin/feature/*` branch in one
 * batched `git for-each-ref` call. We pull the SHA + author in
 * the same pass (instead of `git log -1` per ref) because that's
 * N×git invocations → 1 invocation and dramatically faster on
 * remotes with many feature branches.
 *
 * `%(authorname)` / `%(authoremail)` are the *commit* author,
 * not the committer — same semantics as `git log --format='%an
 * <%ae>'`. This is what `git blame` shows too, so the
 * "от Alice" badge matches what the user sees in their forge UI.
 *
 * `%(refname:short)` returns the ref without the full
 * `refs/remotes/` prefix — i.e. `origin/feature/OKECS-13078`.
 */
async function listRemoteFeatureBranches(
  openspecDir: string,
): Promise<
  Array<{
    ref: string;
    sha: string;
    name: string;
    email: string;
  }>
> {
  const { stdout } = await runGit(openspecDir, [
    "for-each-ref",
    "--format=%(refname:short)|%(objectname)|%(authorname)|%(authoremail)",
    "refs/remotes/origin/feature/",
  ]);
  const out: Array<{
    ref: string;
    sha: string;
    name: string;
    email: string;
  }> = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // authorname/email can't contain `|` in practice (git
    // validates them as plain text), but the splitter below
    // is defensive anyway.
    const parts = trimmed.split("|");
    if (parts.length < 4) continue;
    const [ref, sha, ...rest] = parts;
    const rawEmail = rest[rest.length - 1] ?? "";
    const name = rest.slice(0, -1).join("|");
    // `%(authoremail)` on some platforms returns the address WITH
    // surrounding `< >` (e.g. "<alice@corp.com>"). Normalise to
    // bare "alice@corp.com" so the persisted `publishedBy.email`
    // is comparable with `git config user.email` and can be shown
    // raw in tooltips.
    const email = rawEmail.replace(/^<|>$/g, "").trim();
    out.push({ ref, sha, name, email });
  }
  return out;
}

/**
 * Inspect `<sha>:openspec/changes/` for one ref. Returns:
 *   - hasProposal: there is at least one proposal.md under
 *     openspec/changes/<tag>/ (non-archive) — this is the
 *     gate for "is this a valid change-proposal"
 *   - tag: the FIRST tag folder we encounter — there should
 *     only ever be one, but if a branch accidentally contains
 *     two we'll pick the first lexically. The merge step
 *     catches tag collisions separately.
 *   - hasSpecs / hasDesign: presence of specs/* and design.md
 *     anywhere under that change folder.
 *
 * Archive trees are intentionally ignored — only live
 * proposals are surfaced on the board. The dev-mode scanner
 * already implements this filter; we replicate it here for
 * consistency.
 */
async function inspectChangeTree(
  openspecDir: string,
  sha: string,
): Promise<{
  hasProposal: boolean;
  tag: string | null;
  hasSpecs: boolean;
  hasDesign: boolean;
  hasAdr: boolean;
}> {
  let paths: string[];
  try {
    const { stdout } = await runGit(openspecDir, [
      "ls-tree",
      "-r",
      "--name-only",
      sha,
      "openspec/changes/",
    ]);
    paths = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return {
      hasProposal: false,
      tag: null,
      hasSpecs: false,
      hasDesign: false,
      hasAdr: false,
    };
  }
  let tag: string | null = null;
  let hasProposal = false;
  let hasSpecs = false;
  let hasDesign = false;
  let hasAdr = false;
  for (const p of paths) {
    if (p.startsWith("openspec/changes/archive/")) continue;
    const m = p.match(/^openspec\/changes\/([^/]+)\//);
    if (!m || m[1] === "archive") continue;
    if (!tag) tag = m[1];
    if (p.endsWith("/proposal.md")) {
      // proposal.md found — the branch is valid. We keep
      // walking the loop to also pick up hasDesign / hasSpecs /
      // hasAdr (they may appear after proposal.md in ls-tree
      // output).
      hasProposal = true;
    }
    if (p.includes("/specs/")) hasSpecs = true;
    if (p.endsWith("/design.md")) hasDesign = true;
    if (p.endsWith("/adr.md")) hasAdr = true;
  }
  return { hasProposal, tag, hasSpecs, hasDesign, hasAdr };
}

/**
 * Read `<sha>:openspec/changes/<tag>/proposal.md` and parse it.
 * Returns null on read failure (proposal.md disappeared between
 * ls-tree and show, blob too large, etc.).
 *
 * The 16MB cap matches our worst-case observed proposal (a
 * 14MB prose dump from a megaproject). Going larger risks
 * execFile's default maxBuffer bailout. If a proposal really
 * is bigger, the card will surface without title/description
 * rather than crashing the scan.
 */
async function readProposalOnBranch(
  openspecDir: string,
  sha: string,
  tag: string,
): Promise<
  | { title: string; description: string; jiraUrl: string | null }
  | null
> {
  try {
    const { stdout } = await runGit(
      openspecDir,
      ["show", `${sha}:openspec/changes/${tag}/proposal.md`],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return parseProposalMarkdown(stdout);
  } catch (e) {
    console.warn(
      `[feature-branches-scanner] could not read proposal on ${sha}:${tag}:`,
      e,
    );
    return null;
  }
}

/**
 * Main entry point. Returns one entry per remote feature
 * branch that has a proposal.md. Branches without proposal.md
 * are still returned with `hasProposal: false` and `error` —
 * callers (the merge step) can decide whether to surface them
 * for inspection or drop them silently. In the current MVP we
 * drop them: a feature branch with no proposal is not a task.
 */
export async function scanRemoteFeatureBranches(
  openspecDir: string,
): Promise<RemoteBranchProposal[]> {
  await fetchOrigin(openspecDir);
  const refs = await listRemoteFeatureBranches(openspecDir);
  if (refs.length === 0) return [];

  const out: RemoteBranchProposal[] = [];
  for (const r of refs) {
    // Branch without the `origin/` prefix is what we'll store
    // and display. Sanity-check JIRA-ID format so we ignore
    // scratch branches like `feature/WIP` or `feature/test`.
    const branch = r.ref.replace(/^origin\//, "");
    const jiraId = branch.replace(/^feature\//, "");
    if (!JIRA_ID_PATTERN.test(jiraId)) continue;

    let tree: Awaited<ReturnType<typeof inspectChangeTree>>;
    try {
      tree = await inspectChangeTree(openspecDir, r.sha);
    } catch (e) {
      // Failed branches emit a stub with no proposal and no yaml —
      // these never reach the merge step (the missing-proposal guard
      // below drops them), but we keep the shape uniform so callers
      // don't have to special-case `error` objects.
      out.push({
        branch,
        remoteRef: r.ref,
        jiraId,
        sha: r.sha,
        publishedBy: { name: r.name, email: r.email },
        hasProposal: false,
        tag: null,
        hasSpecs: false,
        hasDesign: false,
        hasAdr: false,
        yamlTitle: null,
        yamlStage: null,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    if (!tree.hasProposal || !tree.tag) {
      // No proposal.md → not a valid change. Skip.
      continue;
    }

    // Read both the proposal body and the metadata side by side.
    //
    // proposal.md is the user-authored description — first heading
    // there doubles as the card title when no .openspec.yaml is
    // present (older changes / hand-published branches without our
    // publish-stage hook). The yaml file, when present, carries the
    // author's verified `title:` and `stage:`. We default the card to
    // yaml fields and let the merge step downgrade to proposal.md only
    // when both yaml signals are missing.
    //
    // Failure of either read is non-fatal — we still emit an entry so
    // the next scan can retry; the merge step treats nulls as "use the
    // other source".
    const [proposal, yamlMeta] = await Promise.all([
      readProposalOnBranch(openspecDir, r.sha, tree.tag),
      readChangeMetadataFromGit(openspecDir, r.sha, tree.tag),
    ]);

    out.push({
      branch,
      remoteRef: r.ref,
      jiraId,
      sha: r.sha,
      publishedBy: { name: r.name, email: r.email },
      hasProposal: true,
      tag: tree.tag,
      hasSpecs: tree.hasSpecs,
      hasDesign: tree.hasDesign,
      hasAdr: tree.hasAdr,
      proposalTitle: proposal?.title,
      proposalDescription: proposal?.description,
      jiraUrl: proposal?.jiraUrl ?? null,
      yamlTitle: yamlMeta.title,
      yamlStage: yamlMeta.stage,
    });
  }

  // Stable order: by remote ref name. Lets the merge scan
  // produce deterministic state.json diffs.
  out.sort((a, b) => a.remoteRef.localeCompare(b.remoteRef));
  return out;
}
