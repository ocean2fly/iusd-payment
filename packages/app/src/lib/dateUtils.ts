/**
 * Parse a timestamp string into a Date, handling both ISO and PostgreSQL formats.
 * Safari/iOS can't parse: "2026-04-05 02:08:54.827+00" (space instead of T, short tz)
 */
export function parseTimestamp(ts: string): Date {
  let s = ts.replace(' ', 'T')               // "2026-04-05 ..." → "2026-04-05T..."
  if (/[+-]\d{2}$/.test(s)) s += ':00'        // "+00" → "+00:00"
  if (!/[Z+-]/.test(s.slice(-6))) s += 'Z'    // no timezone → assume UTC
  return new Date(s)
}
