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
 * Discriminated result of {@link normalizeRepoName}. Callers can
 * surface `error` verbatim through the existing API error channel;
 * UI uses it as an inline hint next to the live preview.
 */
export type NormalizeResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

/**
 * Bring an arbitrary string into the kebab-case shape expected by
 * {@link isValidRepoName}, so users don't have to rename upstream
 * repositories whose canonical names contain `_`, `.`, uppercase
 * letters, or other shell‑safe path segments.
 *
 * Pipeline:
 *   1. Insert `-` at camelCase boundaries (`fooBar` → `foo-Bar`)
 *      so Pascal/snake/mixed inputs converge on the same shape.
 *   2. Lowercase everything.
 *   3. Replace any run of non-[a-z0-9] with a single `-`.
 *   4. Trim leading/trailing `-` and collapse repeats (the regex
 *      from step 3 already collapses runs).
 *   5. Reject empty results (e.g. input was all separators) or
 *      anything still longer than 40 characters.
 *
 * Returns `{ ok: true, name }` when the normalized form also passes
 * the strict {@link isValidRepoName} validator; otherwise
 * `{ ok: false, error }` with a human-readable Russian reason the
 * route handler / SettingsDialog can render.
 *
 * Deliberately does NOT touch the original URL — that stays in
 * config under `RepoConfig.url` so round-trips to git keep the
 * authoritative remote URL. Only the local directory key gets
 * normalized.
 */
export function normalizeRepoName(raw: string): NormalizeResult {
  // Step 1+2: split at `[a-z0-9][A-Z]` boundary first, then lowercase,
  // so "MyService" → "My-Service" → "my-service". Order matters: if we
  // lowercased first we'd lose the case information needed for splits.
  const split = raw.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  // Step 3+4: collapse every non-[a-z0-9] run into one `-`,
  // then trim edges. After this point only `[a-z0-9-]` remains.
  const dashed = split.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (dashed.length === 0) {
    return {
      ok: false,
      error:
        "Не удалось получить имя репозитория из этого сегмента URL (остались только разделители)",
    };
  }
  if (dashed.length > 40) {
    return {
      ok: false,
      error: `Имя после нормализации длиннее 40 символов (получилось ${dashed.length}): переименуйте репо или используйте более короткий alias`,
    };
  }
  if (!isValidRepoName(dashed)) {
    // The remaining failure mode is "starts with a digit"; surface
    // it explicitly because no amount of normalization fixes that —
    // upstream needs a letter prefix.
    return {
      ok: false,
      error: `Имя "${raw}" не приводится к kebab-case (результат "${dashed}" начинается с цифры)`,
    };
  }
  return { ok: true, name: dashed };
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