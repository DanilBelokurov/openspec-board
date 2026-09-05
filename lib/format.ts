/**
 * Deterministic date formatter for SSR — avoids hydration mismatch.
 *
 * `toLocaleString` differs between Node ICU and browser ICU, so the
 * server-rendered HTML doesn't match the client render. We use a
 * manual DD.MM.YYYY HH:MM format in Moscow time (UTC+3, no DST since 2014).
 * Looks Russian (DD.MM) and is byte-identical on server and client.
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const moscowMs = d.getTime() + 3 * 60 * 60 * 1000;
  const moscow = new Date(moscowMs);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(moscow.getUTCDate())}.${pad(moscow.getUTCMonth() + 1)}.${moscow.getUTCFullYear()} ${pad(moscow.getUTCHours())}:${pad(moscow.getUTCMinutes())} MSK`;
}