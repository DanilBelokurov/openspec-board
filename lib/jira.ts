/**
 * Extract ticket id (e.g. ENG-123) from various Jira URL formats:
 *   - https://company.atlassian.net/browse/ENG-123 → ENG-123
 *   - https://company.atlassian.net/browse/ENG-123?foo=bar → ENG-123
 *   - ENG-123 → ENG-123
 *   - abc/ENG-123 → ENG-123 (last path segment)
 *
 * Pure: no node-only dependencies. Safe to import from client components.
 */
export function extractJiraId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try to parse as URL first
  try {
    const u = new URL(trimmed);
    const parts = u.pathname.split("/").filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(parts[i])) {
        return parts[i];
      }
    }
    // Fallback to last path segment
    return parts[parts.length - 1] ?? null;
  } catch {
    // Not a URL — treat as raw ticket id
    const m = trimmed.match(/[A-Za-z][A-Za-z0-9_]*-\d+/);
    return m ? m[0] : null;
  }
}

/**
 * Strict "branch-shaped" JIRA id: UPPERCASE prefix, dash, digits.
 * Used by callers that filter raw branch tokens (`feature/<id>`)
 * and want to reject lowercase URLs, ticket mentions, WIP branches
 * (`feature/WIP`), or anything that isn't a clean `<KEY>-<NUM>`.
 *
 * Note: this is STRICTER than the matcher inside extractJiraId —
 * branch names follow the team convention of all-caps project keys,
 * so we reject `eng-123` even though `extractJiraId` would accept
 * it. The two functions serve different purposes and the
 * divergence is intentional.
 */
export const JIRA_ID_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;