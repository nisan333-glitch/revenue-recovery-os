// TimestampAuthority — Trust Invariant #3: pre-registration / approval timestamps must be
// system-recorded and not editable through normal Case editing (separate from user-entered
// business dates). PROTOTYPE-GRADE ONLY: a browser/system clock is NOT tamper-evident. This is
// the honest seam for a future server-side or append-only trusted source; treat these timestamps
// as prototype trust level, not enterprise-grade.

export interface TimestampAuthority {
  /** A system-recorded ISO timestamp. Not user-supplied, not editable via Case fields. */
  now(): string;
}

export const systemTimestampAuthority: TimestampAuthority = Object.freeze({
  now: () => new Date().toISOString(),
});

/**
 * Deterministic authority for tests/fixtures — advances by 1ms per call from a fixed origin so
 * ordering is stable and reproducible without wall-clock flakiness.
 */
export function fixedTimestampAuthority(startIso: string): TimestampAuthority {
  let t = new Date(startIso).getTime();
  return { now: () => new Date(t++).toISOString() };
}
