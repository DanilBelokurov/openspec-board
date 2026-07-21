/**
 * Validate a tag against the `openspec new change` naming rules.
 * Per docs/docs/cli.md §"openspec new change":
 *   - lowercase kebab-case
 *   - starts with a lowercase letter
 *   - lowercase letters, digits and single hyphens only
 *   - no consecutive hyphens, no leading/trailing hyphens
 *   - 1-40 chars
 */
export function isValidOpenspecTag(tag: string): boolean {
  if (tag.length === 0 || tag.length > 40) return false;
  if (!/^[a-z0-9-]+$/.test(tag)) return false;
  if (tag.startsWith("-") || tag.endsWith("-")) return false;
  if (tag.includes("--")) return false;
  if (!/^[a-z]/.test(tag)) return false;
  return true;
}
