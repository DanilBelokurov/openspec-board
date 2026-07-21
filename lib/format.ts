/**
 * Deterministic date formatter for SSR — avoids hydration mismatch.
 *
 * `toLocaleString` differs between Node ICU and browser ICU, so the
 * server-rendered HTML doesn't match the client render. We use a
 * manual DD.MM.YYYY HH:MM format in UTC (no locale, no timezone lookup).
 * Looks Russian (DD.MM) and is byte-identical on server and client.
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}