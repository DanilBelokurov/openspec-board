/**
 * Platform-aware builder for the "open branch on web UI" URL.
 *
 * `commitAndPushRedTests` (lib/continuation.ts) and the
 * RED-push retry endpoint capture the raw git remote via
 * `git config --get remote.origin.url`. Different forges
 * expose branches under different URL shapes, and the
 * internal Sber Bitbucket Data Center instance adds two
 * twists on top of plain Bitbucket DC:
 *
 *   1. The git URL lives on `api.<host>:7998` while the
 *      web UI lives on `<host>` (no `api.` prefix, no port).
 *   2. The web path uses `/sc/<project>/<repo>/src/branch/<branch>`
 *      instead of Bitbucket DC's default
 *      `/projects/<key>/repos/<repo>/browse?at=refs/heads/<branch>`
 *      — the Sber-internal `sc-ci.sber.ru` proxy rewrites
 *      paths that way.
 *
 * To keep the call sites simple we expose one pure function:
 *
 *   buildBranchUrl(rawRemoteUrl, branch) -> string | null
 *
 * Inputs:
 *   - rawRemoteUrl: as returned by `git config --get remote.origin.url`
 *     (may be https, ssh, ssh-alt, ssh-protocol, …)
 *   - branch: branch name (may contain `/`, e.g. `feature/OKECS-13080`)
 *
 * Output:
 *   - full clickable https URL pointing at the branch on the
 *     matching web UI
 *   - `null` when the input is malformed (caller renders no link)
 *
 * Pure: no fs, no child_process, safe to import from client
 * components and from unit tests.
 */

export type Platform =
  | "bitbucket-dc-sber"
  | "stash"
  | "github"
  | "gitlab"
  | "bitbucket-cloud"
  | "unknown";

/**
 * Map of "internal Bitbucket DC web host" by git host (no port).
 *
 * To onboard a new internal Bitbucket DC instance, add an entry
 * `{ "<gitHost>": "<webHost>" }` — the rest of the pipeline
 * detects Bitbucket DC Sber by matching `<gitHost>` (we match
 * the host with the `api.` prefix stripped).
 *
 * The match also accepts the raw `<webHost>` form, so configs
 * that already point straight at the web host still work.
 */
const SBER_DC_WEB_HOSTS: Record<string, string> = {
  // <gitHost>:<port> when `git config remote.origin.url` returns
  // `https://api.sc-ci.sber.ru:7998/...` we want the link to land
  // on `https://sc-ci.sber.ru/sc/...`.
  "sc-ci.sber.ru": "sc-ci.sber.ru",
  // Also accept the `api.` variant as the canonical git hostname.
  "api.sc-ci.sber.ru": "sc-ci.sber.ru",
};

const SBER_DC_PORTS = new Set(["7990", "7998"]);

interface ParsedRemote {
  host: string;
  port: string | null;
  path: string;
}

/**
 * Parse a raw git remote URL into host / port / path. Tolerates:
 *   https://host[:port]/path
 *   ssh://[git@]host[:port]/path
 *   git@host:path        (SSH alt — no port, `:` is the separator)
 *
 * Returns null when the input doesn't look like a remote URL.
 */
export function parseRemote(rawUrl: string): ParsedRemote | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) return null;

  // SSH alt: git@host:path[.git]
  const sshAlt = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshAlt) {
    return { host: sshAlt[1], port: null, path: sshAlt[2] };
  }

  // http(s) / ssh-protocol: scheme://host[:port]/path
  const proto = trimmed.match(
    /^(?:https?|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::(\d+))?\/(.+?)(?:\.git)?\/?$/,
  );
  if (proto) {
    return { host: proto[1], port: proto[2] ?? null, path: proto[3] };
  }

  return null;
}

export function detectPlatform(rawUrl: string): Platform {
  const parsed = parseRemote(rawUrl);
  if (!parsed) return "unknown";

  // Bitbucket DC behind the Sber internal proxy.
  // Match by either the bare web host (already stripped of api. in
  // some configs) or by `api.<webHost>` + one of the known DC ports.
  const webHostFromMap = SBER_DC_WEB_HOSTS[parsed.host];
  const isApiPrefixed = parsed.host.startsWith("api.");
  const hostAfterApi = isApiPrefixed ? parsed.host.slice(4) : parsed.host;
  const sberDcMatch =
    SBER_DC_WEB_HOSTS[hostAfterApi] &&
    (parsed.port === null || SBER_DC_PORTS.has(parsed.port));
  if (sberDcMatch || webHostFromMap) {
    return "bitbucket-dc-sber";
  }

  const lower = parsed.host.toLowerCase();
  if (/^(?:[a-z0-9-]+\.)?github\.com$/i.test(lower)) return "github";
  if (/^(?:[a-z0-9-]+\.)?gitlab\.com$/i.test(lower)) return "gitlab";
  if (lower.includes("gitlab")) return "gitlab";
  if (/^(?:[a-z0-9-]+\.)?bitbucket\.org$/i.test(lower))
    return "bitbucket-cloud";
  if (lower.includes("stash")) return "stash";

  return "unknown";
}

export function splitProjectRepo(path: string): { project: string; repo: string } {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return { project: "", repo: "" };
  if (segments.length === 1) return { project: "", repo: segments[0] };
  // For Bitbucket DC paths are typically `<project>/<repo>` — two
  // segments. For nested groups on GitHub / GitLab we keep the
  // tail as the repo and the rest as the project prefix; the
  // templates below just join them with `/` either way.
  const repo = segments[segments.length - 1];
  const project = segments.slice(0, -1).join("/");
  return { project, repo };
}

/**
 * Resolve the public web hostname for a Bitbucket DC Sber remote.
 *   api.sc-ci.sber.ru        → sc-ci.sber.ru
 *   api.sc-ci.sber.ru:7998   → sc-ci.sber.ru
 *   sc-ci.sber.ru            → sc-ci.sber.ru
 */
function sberDcWebHost(parsed: ParsedRemote): string | null {
  const fromMap = SBER_DC_WEB_HOSTS[parsed.host];
  if (fromMap) return fromMap;
  const stripped = parsed.host.startsWith("api.")
    ? parsed.host.slice(4)
    : parsed.host;
  return SBER_DC_WEB_HOSTS[stripped] ?? null;
}

/**
 * Build a clickable branch URL for any supported forge.
 * Returns null when the input isn't a recognizable git remote.
 */
export function buildBranchUrl(
  rawRemoteUrl: string,
  branch: string,
): string | null {
  const trimmedBranch = branch.trim();
  if (trimmedBranch.length === 0) return null;

  const parsed = parseRemote(rawRemoteUrl);
  if (!parsed) return null;

  const platform = detectPlatform(rawRemoteUrl);
  const { project, repo } = splitProjectRepo(parsed.path);
  // Branch names contain `/` (e.g. `feature/OKECS-13080`) that
  // is part of the URL path, NOT a separator — so we can't use
  // `encodeURIComponent`, which would turn it into `%2F`. Instead
  // start from `encodeURI` (which preserves `/` and most reserved
  // chars) and only patch the few genuinely dangerous characters
  // (spaces, `#`, `?`, `&`, `+`) that branch names occasionally
  // carry.
  const encodedBranch = encodeURI(trimmedBranch).replace(
    /[?#&+]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );

  switch (platform) {
    case "bitbucket-dc-sber": {
      const webHost = sberDcWebHost(parsed);
      if (!webHost || !project || !repo) return null;
      return `https://${webHost}/sc/${project}/${repo}/src/branch/${encodedBranch}`;
    }
    case "github":
      return `https://${parsed.host}/${project}/${repo}/tree/${encodedBranch}`;
    case "gitlab":
      return `https://${parsed.host}/${project}/${repo}/-/tree/${encodedBranch}`;
    case "bitbucket-cloud":
      return `https://${parsed.host}/${project}/${repo}/src/${encodedBranch}`;
    case "stash":
      return `https://${parsed.host}/projects/${project}/repos/${repo}/browse?at=refs/heads/${encodedBranch}`;
    case "unknown":
    default:
      // Best-effort fallback — keep the current `tree/<branch>`
      // shape so unknown forges still render a usable link.
      if (!project || !repo) return null;
      return `https://${parsed.host}/${project}/${repo}/tree/${encodedBranch}`;
  }
}
