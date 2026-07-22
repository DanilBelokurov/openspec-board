/**
 * Pure (no-fs) helpers for deriving / validating submodule names.
 *
 * Lives in its own module so client components (SettingsDialog) can
 * import `deriveRepoNameFromUrl` for the live preview without pulling
 * in `lib/config.ts` and its `fs/promises` dependency. Importing
 * `lib/config.ts` from a client component makes webpack try to bundle
 * the server-only fs code into the browser bundle, which fails.
 */

/**
 * kebab-case path-segment validator. Same shape as
 * `lib/tag.ts → isValidOpenspecTag` — lowercase letters, digits,
 * and single dashes; must start with a letter; 1–40 chars; no
 * double dashes. Used for both the openspec change name and the
 * repo submodule name; the two cannot collide because change
 * folders live inside openspec/changes/ while submodules live in
 * repos/.
 */
export function isValidRepoName(name: string): boolean {
  return (
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) &&
    name.length >= 1 &&
    name.length <= 40
  );
}

/**
 * Lightweight URL validation for the repos panel — accepts http(s)
 * and ssh-style git URLs. Not a full RFC-3986 check; just enough to
 * catch typos before we shell out to `git submodule add`.
 */
export function isValidRepoUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  return /^(https?:\/\/|ssh:\/\/|git@|git:\/\/)/i.test(trimmed);
}

/**
 * Derive the submodule directory name from a git URL.
 *
 *   https://github.com/org/my-service.git  → my-service
 *   git@github.com:org/my-service.git      → my-service
 *   ssh://git@gitlab/group/my-app.git       → my-app
 *   https://github.com/org/team/repo/       → repo
 *
 * Strips a trailing `.git` and trailing slashes, then takes the
 * final `/`- or `:`-separated segment. Returns null when nothing
 * usable comes out (so the caller can surface a friendly 400
 * instead of guessing).
 */
export function deriveRepoNameFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  // Drop trailing slash(es)
  const noSlash = trimmed.replace(/\/+$/, "");
  // Take the last segment after / or : (ssh-style uses : as the
  // path separator, e.g. git@github.com:org/repo)
  const last = noSlash.split(/[/:]/).pop();
  if (!last) return null;
  // Drop a single .git suffix (case-insensitive — some servers use
  // .Git on purpose).
  const cleaned = last.replace(/\.git$/i, "");
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Validates a ref-ish branch name. Reject empty / whitespace,
 * control chars, leading dashes, double dots, etc. — anything git
 * itself would refuse.
 */
export function isValidRepoBranch(branch: string): boolean {
  const trimmed = branch.trim();
  if (trimmed.length === 0) return false;
  return /^(?!.*\.\.)(?!\/)(?!.*\/\/)(?!.*@\{)[^\x00-\x20\x7f]+$/.test(
    trimmed,
  );
}