// Date normalization — timezone-agnostic, day-granularity, and LOUD about ambiguity.
//
// Policy:
//  • Output is always a canonical ISO date "YYYY-MM-DD".
//  • ISO inputs (with or without a time/zone) are accepted; the date part is taken (day granularity).
//  • Numeric D/M/Y or M/D/Y inputs are AMBIGUOUS: accepted only when one part is > 12 (self-
//    disambiguating) or an explicit locale ("MDY" | "DMY") is supplied. Otherwise rejected.
//  • Month-name inputs ("2 Jan 2026", "Jan 2, 2026") are unambiguous and accepted.
//  • Anything else is rejected as malformed. No silent guessing.

export type DateLocale = "MDY" | "DMY";

export type DateResult =
  | { ok: true; iso: string }
  | { ok: false; reason: "malformed_date" | "ambiguous_date"; detail: string };

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reject impossible day-of-month using a UTC round-trip.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function normalizeDate(input: string, opts: { locale?: DateLocale } = {}): DateResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, reason: "malformed_date", detail: "empty" };

  // ISO (optionally with a time/zone we drop) → take the date part, day granularity.
  const isoM = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(raw);
  if (isoM) {
    const [y, m, d] = [Number(isoM[1]), Number(isoM[2]), Number(isoM[3])];
    return valid(y, m, d) ? { ok: true, iso: iso(y, m, d) } : { ok: false, reason: "malformed_date", detail: raw };
  }

  // Y/M/D with slashes → unambiguous (year first).
  const ymd = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(raw);
  if (ymd) {
    const [y, m, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
    return valid(y, m, d) ? { ok: true, iso: iso(y, m, d) } : { ok: false, reason: "malformed_date", detail: raw };
  }

  // Month-name forms: "2 Jan 2026" or "Jan 2 2026" / "Jan 2, 2026".
  const dmName = /^(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{4})$/.exec(raw);
  if (dmName) {
    const mm = MONTHS[dmName[2]!.slice(0, 3).toLowerCase()];
    const [d, y] = [Number(dmName[1]), Number(dmName[3])];
    if (mm && valid(y, mm, d)) return { ok: true, iso: iso(y, mm, d) };
    return { ok: false, reason: "malformed_date", detail: raw };
  }
  const nameD = /^([A-Za-z]{3,})[ -](\d{1,2}),?[ -](\d{4})$/.exec(raw);
  if (nameD) {
    const mm = MONTHS[nameD[1]!.slice(0, 3).toLowerCase()];
    const [d, y] = [Number(nameD[2]), Number(nameD[3])];
    if (mm && valid(y, mm, d)) return { ok: true, iso: iso(y, mm, d) };
    return { ok: false, reason: "malformed_date", detail: raw };
  }

  // Numeric A/B/YYYY with '/' or '-' → potentially ambiguous.
  const ab = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (ab) {
    const a = Number(ab[1]);
    const b = Number(ab[2]);
    const y = Number(ab[3]);
    // Self-disambiguating: exactly one of the two parts exceeds 12 → it must be the day.
    const aIsDay = a > 12;
    const bIsDay = b > 12;
    if (aIsDay && !bIsDay) return valid(y, b, a) ? { ok: true, iso: iso(y, b, a) } : { ok: false, reason: "malformed_date", detail: raw };
    if (bIsDay && !aIsDay) return valid(y, a, b) ? { ok: true, iso: iso(y, a, b) } : { ok: false, reason: "malformed_date", detail: raw };
    if (aIsDay && bIsDay) return { ok: false, reason: "malformed_date", detail: raw };
    // Both ≤ 12 → genuinely ambiguous; require an explicit locale.
    if (!opts.locale) return { ok: false, reason: "ambiguous_date", detail: raw };
    const [m, d] = opts.locale === "MDY" ? [a, b] : [b, a];
    return valid(y, m, d) ? { ok: true, iso: iso(y, m, d) } : { ok: false, reason: "malformed_date", detail: raw };
  }

  return { ok: false, reason: "malformed_date", detail: raw };
}

/** Days since the Unix epoch for an ISO date (UTC, day granularity). */
export function epochDay(isoDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`epochDay: not an ISO date (${isoDate})`);
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** True when date `a` is strictly after date `b` (day granularity). */
export function isAfter(a: string, b: string): boolean {
  return epochDay(a) > epochDay(b);
}

/** Add `n` days to an ISO date, returning an ISO date. */
export function addDays(isoDate: string, n: number): string {
  const ms = (epochDay(isoDate) + n) * 86_400_000;
  const dt = new Date(ms);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
