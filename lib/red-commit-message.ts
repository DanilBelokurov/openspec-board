/**
 * Builder for the auto-commit message created by
 * `commitAndPushRedTests` (lib/continuation.ts) after a RED-phase
 * gigacode run exits with code 0.
 *
 * The historical format was just
 *   `test: RED-phase tests for <serviceName>`
 * which gave reviewers no way to tie a stack of RED commits back
 * to the originating ticket. We now prepend the Jira key when we
 * can extract it from `task.jiraUrl`:
 *
 *   `[<JIRA-ID>] test: RED-phase tests for <serviceName>`
 *
 * — and fall back to the legacy un-prefixed form when we cannot,
 * so a missing/malformed `jiraUrl` never blocks the commit. The
 * fallback path emits a `console.warn` so the operator notices
 * state.json drift instead of silently regressing.
 *
 * The "updated" variant (pencil-flow revision) appends
 * ` (updated)` so the branch history still tells RED-1 from
 * RED-2 apart at a glance.
 *
 * Pure: no fs, no child_process, safe to import from client
 * components and from unit tests.
 */

import { extractJiraId } from "./jira";
import type { TaskEntry } from "./state";

export type RedCommitMessageVariant = "initial" | "updated";

interface RedCommitTaskShape {
  jiraUrl?: string;
  serviceName?: string;
}

/**
 * Sanitize the service name before splicing it into a commit
 * message. `git commit -m` is invoked via `execFile` (no shell),
 * so shell-injection isn't a concern — but multi-line or NUL
 * input would either break the message or render as garbage in
 * `git log --oneline`, both of which we want to avoid.
 */
function sanitizeServiceName(raw: string): string {
  return raw
    .replace(/[\r\n]+/g, " ")
    .replace(/\0/g, "")
    .trim();
}

/**
 * Defensive: `extractJiraId` already constrains output to
 * `/^[A-Za-z][A-Za-z0-9_]*-\d+$/`, but if a future caller
 * relaxes that we'd rather render `[ENG-1]` than `[[ENG-1]]`.
 */
function stripBrackets(key: string): string {
  return key.replace(/^\[+|\]+$/g, "");
}

/**
 * Build the auto-commit message used by `commitAndPushRedTests`.
 *
 * @param task          Source task — only `jiraUrl` and
 *                      `serviceName` are read.
 * @param variant       `"initial"` for the first RED commit,
 *                      `"updated"` for pencil-flow revisions.
 *                      Defaults to `"initial"`.
 */
export function buildRedCommitMessage(
  task: RedCommitTaskShape,
  variant: RedCommitMessageVariant = "initial",
): string {
  const sanitized = sanitizeServiceName(task.serviceName ?? "");
  const service = sanitized.length > 0 ? sanitized : "service";
  const suffix = variant === "updated" ? " (updated)" : "";
  const body = `test: RED-phase tests for ${service}${suffix}`;

  const rawUrl = task.jiraUrl?.trim() ?? "";
  if (rawUrl.length === 0) return body;

  const jiraKey = extractJiraId(rawUrl);
  if (!jiraKey) {
    // jiraUrl was present but didn't yield a key — surface it so
    // we don't silently lose the ticket prefix.
    console.warn(
      `[red-commit-message] task has jiraUrl="${rawUrl}" but extractJiraId returned null; falling back to un-prefixed message`,
    );
    return body;
  }

  return `[${stripBrackets(jiraKey)}] ${body}`;
}

/**
 * Convenience: extract just the Jira key for the `[<KEY>]` prefix.
 * Returns `null` when no key can be derived. Useful when callers
 * want to render the prefix separately (e.g. in UI badges).
 */
export function extractRedCommitJiraKey(task: RedCommitTaskShape): string | null {
  const rawUrl = task.jiraUrl?.trim() ?? "";
  if (rawUrl.length === 0) return null;
  const key = extractJiraId(rawUrl);
  return key ? stripBrackets(key) : null;
}

// Re-export so tests and other call sites have a single import.
export type { TaskEntry };
